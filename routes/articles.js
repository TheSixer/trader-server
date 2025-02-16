import express from 'express';
import db from '../config/db.js';
import verifyToken from '../middleware/auth.js';

const router = express.Router();

// 获取文章列表
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const category_id = req.query.category_id;

    let query = `
      SELECT a.*, c.name as category_name
      FROM articles a
      LEFT JOIN categories c ON a.category_id = c.id
    `;

    let countQuery = `SELECT COUNT(*) as total FROM articles a`;
    let params = [];

    if (category_id) {
      query += ` WHERE a.category_id = ?`;
      countQuery += ` WHERE a.category_id = ?`;
      params.push(category_id);
    }

    query += ` ORDER BY a.is_top DESC, a.sort_order DESC, a.created_at DESC
               LIMIT ? OFFSET ?`;
    
    params.push(limit, offset);

    const [articles] = await db.query(query, params);
    const [totalRows] = await db.query(countQuery, category_id ? [category_id] : []);

    // 处理标签
    articles.forEach(article => {
      article.tags = article.tags ? article.tags.split(',') : [];
    });

    res.json({
      data: articles,
      pagination: {
        current: page,
        size: limit,
        total: totalRows[0].total
      }
    });

  } catch (error) {
    console.error('获取文章列表失败:', error);
    res.status(500).json({ message: '获取文章列表失败' });
  }
});

// 获取文章详情
router.get('/:id', async (req, res) => {
  try {
    const [articles] = await db.query(`
      SELECT 
        a.id,
        a.title,
        a.content,
        a.user_id,
        a.category_id,
        a.views,
        a.likes,
        a.created_at,
        a.updated_at,
        u.username,
        c.name as category_name,
        (SELECT COUNT(*) FROM comments WHERE article_id = a.id) as comment_count,
        a.tags
      FROM articles a
      LEFT JOIN users u ON a.user_id = u.id
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE a.id = ?
    `, [req.params.id]);

    if (articles.length === 0) {
      return res.status(404).json({ message: '文章不存在' });
    }

    const article = articles[0];
    article.tags = article.tags ? article.tags.split(',') : [];

    res.json(article);
  } catch (error) {
    console.error('文章详情查询错误:', error);
    res.status(500).json({ 
      message: error.sqlMessage || '服务器错误',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// 创建文章
router.post('/', verifyToken, async (req, res) => {
  try {
    const {
      title,
      content,
      category_id,
      tags,
      is_recommended,
      is_top,
      cover_image,
      summary,
      sort_order
    } = req.body;

    // 插入文章
    const [result] = await db.query(
      `INSERT INTO articles (
        title, content, category_id, tags,
        is_recommended, is_top, cover_image, 
        summary, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [title, content, category_id, tags?.join(','), 
       is_recommended, is_top, cover_image, 
       summary, sort_order || 0]
    );

    res.status(201).json({
      message: '文章创建成功',
      data: { id: result.insertId }
    });

  } catch (error) {
    console.error('创建文章失败:', error);
    res.status(500).json({ message: '创建文章失败' });
  }
});

// 更新文章
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const {
      title,
      content,
      category_id,
      tags,
      is_recommended,
      is_top,
      cover_image,
      summary,
      sort_order
    } = req.body;

    // 更新文章
    await db.query(
      `UPDATE articles SET 
        title = ?, content = ?, category_id = ?,
        tags = ?, is_recommended = ?, is_top = ?, 
        cover_image = ?, summary = ?, sort_order = ?, 
        updated_at = NOW()
       WHERE id = ?`,
      [title, content, category_id, tags?.join(','),
       is_recommended, is_top, cover_image, 
       summary, sort_order || 0, req.params.id]
    );

    res.json({ message: '文章更新成功' });

  } catch (error) {
    console.error('更新文章失败:', error);
    res.status(500).json({ message: '更新文章失败' });
  }
});

// 删除文章
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    await db.query('DELETE FROM articles WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ message: '文章删除成功' });
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// 增加文章浏览量
router.post('/:id/view', async (req, res) => {
  try {
    await db.query(
      'UPDATE posts SET view_count = view_count + 1 WHERE id = ?',
      [req.params.id]
    );
    res.json({ message: '浏览量更新成功' });
  } catch (error) {
    console.error('更新浏览量失败:', error);
    res.status(500).json({ message: '更新浏览量失败' });
  }
});

// 点赞文章
router.post('/:id/like', verifyToken, async (req, res) => {
  try {
    await db.query(
      'UPDATE articles SET likes = likes + 1 WHERE id = ?',
      [req.params.id]
    );
    res.json({ message: '点赞成功' });
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

export default router; 