const express = require('express');
const db = require('../config/db');
const verifyToken = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const OpenAI = require('openai');
const PDFDocument = require('pdfkit');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

const router = express.Router();

// 配置OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 确保报告目录存在
const reportsDir = path.join(__dirname, '../reports');
fs.ensureDirSync(reportsDir);

// 创建问题
router.post('/questions', verifyToken, adminAuth, async (req, res) => {
  const { title, type, is_required, options, sort_order } = req.body;
  
  // 参数验证
  if (!title || !type) {
    return res.status(400).json({ message: '标题和类型不能为空' });
  }

  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();

    // 插入问题
    const [questionResult] = await connection.query(
      'INSERT INTO survey_questions (title, type, is_required, sort_order) VALUES (?, ?, ?, ?)',
      [title, type, is_required || false, sort_order || 0]
    );
    const questionId = questionResult.insertId;

    // 插入选项（如果有）
    if (options && Array.isArray(options) && options.length > 0) {
      const optionValues = options.map((option, index) => [
        questionId, 
        option.content, 
        option.sort_order || index
      ]);

      await connection.query(
        'INSERT INTO survey_question_options (question_id, content, sort_order) VALUES ?',
        [optionValues]
      );
    }

    await connection.commit();

    res.status(201).json({ 
      id: questionId, 
      message: '问题创建成功' 
    });
  } catch (error) {
    await connection.rollback();
    console.error('创建问题错误:', error);
    res.status(500).json({ 
      message: '服务器错误',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    connection.release();
  }
});

// 获取问题列表
router.get('/questions', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    // 获取问题总数
    const [countResult] = await db.query('SELECT COUNT(*) as total FROM survey_questions');
    const total = countResult[0].total;

    // 获取问题列表，包括选项
    const [questions] = await db.query(`
      SELECT 
        q.id, 
        q.title, 
        q.type, 
        q.is_required,
        q.sort_order,
        (
          SELECT GROUP_CONCAT(
            JSON_OBJECT(
              'id', o.id, 
              'content', o.content, 
              'sort_order', o.sort_order
            )
          )
          FROM survey_question_options o 
          WHERE o.question_id = q.id
        ) as options
      FROM survey_questions q
      ORDER BY q.sort_order, q.created_at
      LIMIT ? OFFSET ?
    `, [Number(limit), offset]);

    // 解析选项，处理 null 和解析错误情况
    const processedQuestions = questions.map(q => {
      // 如果 options 为 null，直接返回空数组
      if (!q.options) {
        return {
          ...q,
          options: []
        };
      }

      try {
        // 尝试解析 options，如果失败则返回空数组
        const optionsArray = `[${q.options}]`;
        return {
          ...q,
          options: JSON.parse(optionsArray)
        };
      } catch (parseError) {
        console.error('JSON解析错误:', parseError, '原始数据:', q.options);
        return {
          ...q,
          options: [],
          parseError: parseError.message
        };
      }
    });

    res.json({
      data: processedQuestions,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
      },
    });
  } catch (error) {
    console.error('获取问题列表错误:', error);
    res.status(500).json({ 
      message: '服务器错误', 
      error: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
});

// 更新问题
router.put('/questions/:id', verifyToken, adminAuth, async (req, res) => {
  const { title, type, is_required, options, sort_order } = req.body;
  const questionId = req.params.id;

  // 参数验证
  if (!title || !type) {
    return res.status(400).json({ message: '标题和类型不能为空' });
  }

  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();

    // 更新问题
    await connection.query(
      'UPDATE survey_questions SET title = ?, type = ?, is_required = ?, sort_order = ? WHERE id = ?',
      [title, type, is_required || false, sort_order || 0, questionId]
    );

    // 删除旧选项
    await connection.query(
      'DELETE FROM survey_question_options WHERE question_id = ?', 
      [questionId]
    );

    // 插入新选项（如果有）
    if (options && Array.isArray(options) && options.length > 0) {
      const optionValues = options.map((option, index) => [
        questionId, 
        option.content, 
        option.sort_order || index
      ]);

      await connection.query(
        'INSERT INTO survey_question_options (question_id, content, sort_order) VALUES ?',
        [optionValues]
      );
    }

    await connection.commit();

    res.json({ message: '问题更新成功' });
  } catch (error) {
    await connection.rollback();
    console.error('更新问题错误:', error);
    res.status(500).json({ 
      message: '服务器错误',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    connection.release();
  }
});

// 删除问题
router.delete('/questions/:id', verifyToken, adminAuth, async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM survey_questions WHERE id = ?', [req.params.id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: '问题不存在' });
    }
    
    res.json({ message: '问题删除成功' });
  } catch (error) {
    console.error('删除问题错误:', error);
    res.status(500).json({ 
      message: '服务器错误',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 提交问卷回答
router.post('/responses', verifyToken, async (req, res) => {
  const { responses } = req.body;
  const userId = req.user.id;

  // 参数验证
  if (!responses || !Array.isArray(responses) || responses.length === 0) {
    return res.status(400).json({ message: '无效的回答数据' });
  }

  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();

    // 批量插入回答
    const responseValues = responses.map(response => [
      response.question_id, 
      userId, 
      response.response_text || null,
      response.selected_option_ids ? response.selected_option_ids.join(',') : null,
      response.answer_duration || 0  // 新增答题时间
    ]);

    await connection.query(
      'INSERT INTO survey_responses (question_id, user_id, response_text, selected_option_ids, answer_duration) VALUES ?',
      [responseValues]
    );

    await connection.commit();

    res.status(201).json({ message: '问卷提交成功' });
  } catch (error) {
    await connection.rollback();
    console.error('提交问卷错误:', error);
    res.status(500).json({ 
      message: '服务器错误',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    connection.release();
  }
});

// 获取用户问卷回答
router.get('/responses', verifyToken, async (req, res) => {
  try {
    const [responses] = await db.query(`
      SELECT 
        r.id,
        r.question_id,
        q.title as question_title,
        q.type as question_type,
        r.response_text,
        r.selected_option_ids,
        r.answer_duration,  // 新增答题时间
        (
          SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
              'id', o.id, 
              'content', o.content
            )
          )
          FROM survey_question_options o 
          WHERE FIND_IN_SET(o.id, r.selected_option_ids)
        ) as selected_options
      FROM survey_responses r
      JOIN survey_questions q ON r.question_id = q.id
      WHERE r.user_id = ?
    `, [req.user.id]);

    // 解析选项，处理 null 和解析错误情况
    const processedResponses = responses.map(r => {
      try {
        return {
          ...r,
          selected_options: r.selected_options ? JSON.parse(r.selected_options) : [],
          answer_duration: r.answer_duration || 0  // 确保有答题时间
        };
      } catch (parseError) {
        console.error('JSON解析错误:', parseError);
        return {
          ...r,
          selected_options: [],
          answer_duration: r.answer_duration || 0,
          parseError: parseError.message
        };
      }
    });

    res.json(processedResponses);
  } catch (error) {
    console.error('获取问卷回答错误:', error);
    res.status(500).json({ 
      message: '服务器错误', 
      error: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
});

// 获取单个问题详情
router.get('/questions/:id', async (req, res) => {
  try {
    const questionId = req.params.id;

    // 获取问题基本信息
    const [questions] = await db.query(`
      SELECT 
        q.id, 
        q.title, 
        q.type, 
        q.is_required,
        q.sort_order,
        (
          SELECT GROUP_CONCAT(
            JSON_OBJECT(
              'id', o.id, 
              'content', o.content, 
              'sort_order', o.sort_order
            )
          )
          FROM survey_question_options o 
          WHERE o.question_id = q.id
        ) as options
      FROM survey_questions q
      WHERE q.id = ?
    `, [questionId]);

    // 检查问题是否存在
    if (questions.length === 0) {
      return res.status(404).json({ message: '问题不存在' });
    }

    // 解析选项，处理 null 和解析错误情况
    const question = questions[0];
    
    // 如果 options 为 null，直接返回空数组
    if (!question.options) {
      question.options = [];
      return res.json(question);
    }

    try {
      // 尝试解析 options，如果失败则返回空数组
      const optionsArray = `[${question.options}]`;
      question.options = JSON.parse(optionsArray);
      res.json(question);
    } catch (parseError) {
      console.error('JSON解析错误:', parseError, '原始数据:', question.options);
      question.options = [];
      question.parseError = parseError.message;
      res.json(question);
    }
  } catch (error) {
    console.error('获取问题详情错误:', error);
    res.status(500).json({ 
      message: '服务器错误', 
      error: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
});

// 生成用户性格和交易习惯分析报告
router.post('/generate-report', verifyToken, async (req, res) => {
  const userId = req.user.id;
  let connection = null;
  
  try {
    // 设置响应超时，增加到3分钟
    req.setTimeout(180000);
    
    // 获取连接并开始事务
    connection = await db.getConnection();
    await connection.beginTransaction();
    
    const [existingReports] = await connection.query(
      'SELECT id, report_path, created_at FROM user_reports WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
      [userId]
    );
    
    // 如果最新报告的生成时间在一小时内，提示用户等待
    // if (existingReports.length > 0) {
    //   const lastReport = existingReports[0];
    //   const reportCreationTime = new Date(lastReport.created_at);
    //   const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      
    //   if (reportCreationTime > oneHourAgo) {
    //     return res.status(429).json({ 
    //       message: '您已经在一小时内请求过报告，请稍后再试' 
    //     });
    //   }
    // }

    // 获取用户的所有问卷回答
    const [responses] = await connection.query(`
      SELECT 
        r.id,
        r.question_id,
        q.title as question_title,
        q.type as question_type,
        r.response_text,
        r.selected_option_ids,
        r.answer_duration,
        (
          SELECT GROUP_CONCAT(o.content SEPARATOR ', ')
          FROM survey_question_options o 
          WHERE FIND_IN_SET(o.id, r.selected_option_ids)
        ) as selected_options_text
      FROM survey_responses r
      JOIN survey_questions q ON r.question_id = q.id
      WHERE r.user_id = ?
    `, [userId]);

    if (responses.length === 0) {
      return res.status(400).json({ message: '没有足够的问卷回答来生成报告' });
    }

    // 获取用户信息
    const [userInfo] = await connection.query(
      'SELECT id, username, nickname, email FROM customer WHERE id = ?',
      [userId]
    );

    if (userInfo.length === 0) {
      return res.status(404).json({ message: '用户不存在' });
    }

    const user = userInfo[0];

    // 创建一个新的报告记录
    const reportName = `${user.nickname || user.username}_性格分析报告_${new Date().toISOString().substring(0, 10)}`;
    const reportFilename = `${Date.now()}_${userId}_report.pdf`;
    const reportPath = path.join(reportsDir, reportFilename);

    const [reportResult] = await connection.query(
      'INSERT INTO user_reports (user_id, report_name, report_path) VALUES (?, ?, ?)',
      [userId, reportName, `/reports/${reportFilename}`]
    );

    const reportId = reportResult.insertId;

    // 准备问卷数据以发送给ChatGPT
    const questionAnswers = responses.map(r => {
      return {
        question: r.question_title,
        answer: r.response_text || r.selected_options_text || '未回答',
        duration: r.answer_duration || 0
      };
    });

    // 准备给ChatGPT的请求内容
    const promptContent = `
      请基于以下问卷回答分析用户的性格和可能的交易习惯。
      给出详细、专业的分析结果，并提供针对性的建议。
      分析需要包含以下几个部分：
      1. 用户性格特点
      2. 交易风格倾向
      3. 风险承受能力
      4. 决策模式
      5. 情绪控制能力
      6. 针对性的改进建议

      用户信息：
      用户ID：${userId}
      用户名：${user.nickname || user.username}

      问卷回答：
      ${JSON.stringify(questionAnswers, null, 2)}
    `;

    // 在关键操作前释放连接
    await connection.commit();
    connection.release();
    connection = null;
    
    // 使用 AbortController 安全地调用 OpenAI API - 增加超时时间至120秒
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 增加到120秒
    
    // 添加重试逻辑
    let retries = 0;
    const maxRetries = 2;
    let analysisResult = null;
    
    while (retries <= maxRetries) {
      try {
        console.log(`尝试调用 OpenAI API (尝试 ${retries + 1}/${maxRetries + 1})...`);
        
        const completion = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            { role: "system", content: "你是一位专业的金融交易心理分析师和性格分析专家。" },
            { role: "user", content: promptContent }
          ],
          temperature: 0.7,
          max_tokens: 2500
        }, {
          signal: controller.signal
        });
        
        analysisResult = completion.choices[0].message.content;
        console.log("OpenAI API 调用成功");
        break; // 成功后跳出循环
        
      } catch (apiError) {
        retries++;
        console.error(`OpenAI API 调用失败 (尝试 ${retries}/${maxRetries + 1}):`, apiError);
        
        if (apiError.name === 'AbortError' || retries > maxRetries) {
          if (retries > maxRetries) {
            console.error("已达到最大重试次数");
          }
          throw apiError; // 超出重试次数或是中断错误，向上抛出
        }
        
        // 等待1秒后重试
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // 清除超时
    clearTimeout(timeoutId);
    
    if (!analysisResult) {
      throw new Error("无法获取分析结果");
    }
    
    // 重新获取连接更新数据库
    connection = await db.getConnection();
    await connection.query(
      'UPDATE user_reports SET report_summary = ? WHERE id = ?',
      [analysisResult.substring(0, 500) + '...', reportId]
    );
    connection.release();
    connection = null;
    
    // 创建字体目录
    const fontsDir = path.join(__dirname, '../fonts');
    fs.ensureDirSync(fontsDir);

    // 下载中文字体（如果不存在）
    const fontPath = path.join(fontsDir, 'SourceHanSansCN-Normal.ttf');
    if (!fs.existsSync(fontPath)) {
      console.log('下载中文字体...');
      try {
        const fontResponse = await axios({
          method: 'get',
          url: 'https://github.com/adobe-fonts/source-han-sans/raw/release/OTF/SimplifiedChinese/SourceHanSansSC-Normal.otf',
          responseType: 'arraybuffer'
        });
        fs.writeFileSync(fontPath, Buffer.from(fontResponse.data));
        console.log('字体下载完成');
      } catch (fontError) {
        console.error('字体下载失败:', fontError);
        // 继续使用默认字体
      }
    }

    // 修复 PDF 生成流程
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: reportName,
        Author: '交易者心理分析系统',
        Subject: '用户性格与交易习惯分析报告'
      }
    });
    
    // 创建文件流并正确处理
    const stream = fs.createWriteStream(reportPath);
    doc.pipe(stream);
    
    // 注册并使用中文字体
    if (fs.existsSync(fontPath)) {
      doc.registerFont('SimHei', fontPath);
      doc.font('SimHei');
    }
    
    // 添加报告内容
    doc.fontSize(24).text('交易者心理分析报告', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`生成日期: ${new Date().toLocaleDateString()}`);
    doc.moveDown();
    doc.text(`用户: ${user.nickname || user.username}`);
    doc.moveDown(2);
    
    doc.fontSize(16).text('分析结果', { underline: true });
    doc.moveDown();
    doc.fontSize(12).text(analysisResult);
    
    // 添加原始数据页
    doc.addPage();
    doc.fontSize(16).text('问卷回答原始数据', { underline: true });
    doc.moveDown();
    
    questionAnswers.forEach((qa, index) => {
      doc.fontSize(12).text(`问题 ${index+1}: ${qa.question}`);
      doc.fontSize(12).text(`回答: ${qa.answer}`);
      doc.fontSize(12).text(`回答时间: ${qa.duration} 秒`);
      doc.moveDown();
    });
    
    // 结束文档 - 使用 Promise 等待流完成
    const pdfPromise = new Promise((resolve, reject) => {
      // 监听流事件
      stream.on('finish', resolve);
      stream.on('error', reject);
      
      // 结束 PDF 文档
      doc.end();
    });
    
    // 等待 PDF 生成完成
    await pdfPromise;
    
    // 返回响应
    res.json({
      message: '报告生成成功',
      report_id: reportId,
      report_name: reportName,
      download_url: `/api/survey/reports/${reportId}/download`
    });
    
  } catch (error) {
    console.error('生成报告错误:', error);
    
    // 如果有事务正在进行，回滚事务
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('事务回滚失败:', rollbackError);
      } finally {
        connection.release();
      }
    }
    
    // 错误处理
    let errorMessage = '报告生成失败';
    if (error.name === 'AbortError' || error.message === 'Request was aborted.') {
      errorMessage = 'AI分析超时，请稍后重试';
    } else if (error.code === 'ETIMEDOUT') {
      errorMessage = '数据库连接超时，请稍后重试';
    } else if (error.code === 'ECONNRESET') {
      errorMessage = '连接被重置，请稍后重试';
    } else if (error.code === 'ERR_STREAM_PUSH_AFTER_EOF') {
      errorMessage = 'PDF 生成错误，请稍后重试';
    }
    
    res.status(500).json({ 
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 获取用户的报告列表
router.get('/reports', verifyToken, async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 10 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  
  try {
    // 获取总数
    const [countResult] = await db.query(
      `SELECT COUNT(*) as total 
       FROM user_reports
       WHERE user_id = ?`,
      [userId]
    );
    const total = countResult[0].total;
    
    // 获取分页数据
    const [reports] = await db.query(
      `SELECT id, report_name, report_summary, created_at
       FROM user_reports
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, parseInt(limit), offset]
    );
    
    // 返回符合 React Admin 期望的数据结构
    res.json({
      data: reports,
      pagination: {
        page: parseInt(page),
        perPage: parseInt(limit),
        total
      }
    });
  } catch (error) {
    console.error('获取报告列表错误:', error);
    res.status(500).json({ 
      message: '服务器错误',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 获取所有报告列表 (管理员接口)
router.get('/admin/reports', verifyToken, adminAuth, async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  
  try {
    // 获取总数
    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM user_reports`
    );
    const total = countResult[0].total;
    
    // 获取分页数据
    const [reports] = await db.query(
      `SELECT r.id, r.report_name, r.report_summary, r.created_at, c.username as user_name
       FROM user_reports r
       JOIN customer c ON r.user_id = c.id
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [parseInt(limit), offset]
    );
    
    res.json({
      data: reports,
      pagination: {
        page: parseInt(page),
        perPage: parseInt(limit),
        total
      }
    });
  } catch (error) {
    console.error('获取报告列表错误:', error);
    res.status(500).json({ 
      message: '服务器错误',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 获取单个报告详情
router.get('/reports/:id', verifyToken, async (req, res) => {
  const userId = req.user.id;
  const reportId = req.params.id;
  
  try {
    // 对于普通用户，只能查看自己的报告
    const [reports] = await db.query(
      `SELECT id, report_name, report_path, report_summary, created_at
       FROM user_reports
       WHERE id = ? AND user_id = ?`,
      [reportId, userId]
    );
    
    if (reports.length === 0) {
      return res.status(404).json({ message: '报告不存在或您无权访问' });
    }
    
    res.json(reports[0]);
  } catch (error) {
    console.error('获取报告详情错误:', error);
    res.status(500).json({ 
      message: '服务器错误',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 获取单个报告详情 (管理员接口)
router.get('/admin/reports/:id', verifyToken, adminAuth, async (req, res) => {
  const reportId = req.params.id;
  
  try {
    const [reports] = await db.query(
      `SELECT r.id, r.report_name, r.report_path, r.report_summary, r.created_at, 
              c.username as user_name, c.id as user_id
       FROM user_reports r
       JOIN customer c ON r.user_id = c.id
       WHERE r.id = ?`,
      [reportId]
    );
    
    if (reports.length === 0) {
      return res.status(404).json({ message: '报告不存在' });
    }
    
    res.json(reports[0]);
  } catch (error) {
    console.error('获取报告详情错误:', error);
    res.status(500).json({ 
      message: '服务器错误',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 下载报告
router.get('/reports/:reportId/download', verifyToken, async (req, res) => {
  const userId = req.user.id;
  const reportId = req.params.reportId;
  
  try {
    const [reports] = await db.query(
      `SELECT id, report_name, report_path
       FROM user_reports
       WHERE id = ? AND user_id = ?`,
      [reportId, userId]
    );
    
    if (reports.length === 0) {
      return res.status(404).json({ message: '报告不存在或您无权访问' });
    }
    
    const report = reports[0];
    const reportPath = path.join(__dirname, '..', report.report_path);
    
    if (!fs.existsSync(reportPath)) {
      return res.status(404).json({ message: '报告文件不存在' });
    }
    
    // 设置文件名 (中文需要URL编码)
    const filename = encodeURIComponent(report.report_name + '.pdf');
    
    // 设置响应头
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    
    // 发送文件
    fs.createReadStream(reportPath).pipe(res);
    
  } catch (error) {
    console.error('下载报告错误:', error);
    res.status(500).json({ 
      message: '服务器错误',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 删除报告
router.delete('/reports/:id', verifyToken, async (req, res) => {
  const userId = req.user.id;
  const reportId = req.params.id;
  
  try {
    const connection = await db.getConnection();
    
    try {
      // 先检查报告是否存在且属于当前用户
      const [reports] = await connection.query(
        `SELECT id, report_path FROM user_reports WHERE id = ? AND user_id = ?`,
        [reportId, userId]
      );
      
      if (reports.length === 0) {
        return res.status(404).json({ message: '报告不存在或您无权删除' });
      }
      
      // 获取报告路径用于删除文件
      const reportPath = path.join(__dirname, '..', reports[0].report_path);
      
      // 从数据库中删除报告记录
      await connection.query(
        `DELETE FROM user_reports WHERE id = ?`,
        [reportId]
      );
      
      // 如果文件存在，删除物理文件
      if (fs.existsSync(reportPath)) {
        fs.unlinkSync(reportPath);
      }
      
      res.json({ message: '报告删除成功' });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('删除报告错误:', error);
    res.status(500).json({ 
      message: '服务器错误',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 管理员删除报告
router.delete('/admin/reports/:id', verifyToken, adminAuth, async (req, res) => {
  const reportId = req.params.id;
  
  try {
    const connection = await db.getConnection();
    
    try {
      // 先检查报告是否存在
      const [reports] = await connection.query(
        `SELECT id, report_path FROM user_reports WHERE id = ?`,
        [reportId]
      );
      
      if (reports.length === 0) {
        return res.status(404).json({ message: '报告不存在' });
      }
      
      // 获取报告路径用于删除文件
      const reportPath = path.join(__dirname, '..', reports[0].report_path);
      
      // 从数据库中删除报告记录
      await connection.query(
        `DELETE FROM user_reports WHERE id = ?`,
        [reportId]
      );
      
      // 如果文件存在，删除物理文件
      if (fs.existsSync(reportPath)) {
        fs.unlinkSync(reportPath);
      }
      
      res.json({ message: '报告删除成功' });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('删除报告错误:', error);
    res.status(500).json({ 
      message: '服务器错误',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;