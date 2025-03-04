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
  
  try {
    // 检查是否已经有报告生成中
    const [existingReports] = await db.query(
      'SELECT id, report_path FROM user_reports WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
      [userId]
    );
    
    // 如果最新报告的生成时间在一小时内，提示用户等待
    if (existingReports.length > 0) {
      const lastReport = existingReports[0];
      const reportCreationTime = new Date(lastReport.created_at);
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      
      if (reportCreationTime > oneHourAgo) {
        return res.status(429).json({ 
          message: '您已经在一小时内请求过报告，请稍后再试' 
        });
      }
    }

    // 获取用户的所有问卷回答
    const [responses] = await db.query(`
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
    const [userInfo] = await db.query(
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

    const [reportResult] = await db.query(
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

    // 调用ChatGPT API
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "你是一位专业的金融交易心理分析师和性格分析专家。" },
        { role: "user", content: promptContent }
      ],
      temperature: 0.7,
      max_tokens: 2500
    });

    const analysisResult = completion.choices[0].message.content;

    // 更新数据库中的报告摘要
    await db.query(
      'UPDATE user_reports SET report_summary = ? WHERE id = ?',
      [analysisResult.substring(0, 500) + '...', reportId]
    );

    // 生成PDF报告
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: reportName,
        Author: '交易者心理分析系统',
        Subject: '用户性格与交易习惯分析报告'
      }
    });

    // 写入PDF流
    const stream = fs.createWriteStream(reportPath);
    doc.pipe(stream);

    // 设置中文字体
    // 注意：需要提供字体文件的路径
    // doc.font(path.join(__dirname, '../fonts/simhei.ttf'));

    // 添加报告标题
    doc.fontSize(24).text('交易者心理分析报告', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`生成日期: ${new Date().toLocaleDateString()}`);
    doc.moveDown();
    doc.text(`用户: ${user.nickname || user.username}`);
    doc.moveDown(2);

    // 添加分析结果内容
    doc.fontSize(16).text('分析结果', { underline: true });
    doc.moveDown();
    doc.fontSize(12).text(analysisResult);
    
    // 添加问卷原始数据
    doc.addPage();
    doc.fontSize(16).text('问卷回答原始数据', { underline: true });
    doc.moveDown();
    
    questionAnswers.forEach((qa, index) => {
      doc.fontSize(12).text(`问题 ${index+1}: ${qa.question}`);
      doc.fontSize(12).text(`回答: ${qa.answer}`);
      doc.fontSize(12).text(`回答时间: ${qa.duration} 秒`);
      doc.moveDown();
    });

    // 结束PDF生成
    doc.end();

    // 等待PDF写入完成
    stream.on('finish', async () => {
      res.json({
        message: '报告生成成功',
        report_id: reportId,
        report_name: reportName,
        download_url: `/api/survey/reports/${reportId}/download`
      });
    });

  } catch (error) {
    console.error('生成报告错误:', error);
    res.status(500).json({ 
      message: '报告生成失败',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 获取用户的报告列表
router.get('/reports', verifyToken, async (req, res) => {
  const userId = req.user.id;
  
  try {
    const [reports] = await db.query(
      `SELECT id, report_name, report_summary, created_at
       FROM user_reports
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );
    
    res.json(reports);
  } catch (error) {
    console.error('获取报告列表错误:', error);
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

module.exports = router;