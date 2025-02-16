const express = require('express');
const db = require('../config/db');
const verifyToken = require('../middleware/auth');

const router = express.Router();

// 获取评论列表
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, article_id } = req.query;
    const offset = (page - 1) * limit;

    let conditions = [];
    let params = [];
    
    if (article_id) {
      conditions.push('c.article_id = ?');
      params.push(article_id);
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 获取总数
    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM comments c ${whereClause}`,
      params
    );
    const total = countResult[0].total;

    // 获取评论列表
    const query = `
      SELECT 
        c.id,
        c.content,
        c.user_id,
        c.article_id,
        c.parent_id,
        c.likes,
        c.dislikes,
        c.created_at,
        c.updated_at,
        a.title as article_title,
        (SELECT COUNT(*) FROM comments WHERE parent_id = c.id) as reply_count
      FROM comments c
      LEFT JOIN articles a ON c.article_id = a.id
      ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const [comments] = await db.query(query, [...params, Number(limit), offset]);

    res.json({
      data: comments,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
      },
    });
  } catch (error) {
    console.error('获取评论列表错误:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 获取单个评论及其回复
router.get('/:id', async (req, res) => {
  try {
    // 获取主评论
    const [comments] = await db.query(`
      SELECT 
        c.*,
        u.username,
        u.nickname,
        u.avatar,
        a.title as article_title
      FROM comments c
      LEFT JOIN users u ON c.user_id = u.id
      LEFT JOIN articles a ON c.article_id = a.id
      WHERE c.id = ?
    `, [req.params.id]);

    if (comments.length === 0) {
      return res.status(404).json({ message: '评论不存在' });
    }

    const comment = comments[0];

    // 获取回复
    const [replies] = await db.query(`
      SELECT 
        c.*,
        u.username,
        u.nickname,
        u.avatar
      FROM comments c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.parent_id = ?
      ORDER BY c.created_at ASC
    `, [req.params.id]);

    res.json({
      ...comment,
      replies
    });
  } catch (error) {
    console.error('获取评论详情错误:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 点赞评论
router.post('/:id/like', async (req, res) => {
  try {
    await db.query(
      'UPDATE comments SET likes = likes + 1 WHERE id = ?',
      [req.params.id]
    );
    res.json({ message: '点赞成功' });
  } catch (error) {
    console.error('点赞评论错误:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 踩评论
router.post('/:id/dislike', async (req, res) => {
  try {
    await db.query(
      'UPDATE comments SET dislikes = dislikes + 1 WHERE id = ?',
      [req.params.id]
    );
    res.json({ message: '踩评论成功' });
  } catch (error) {
    console.error('踩评论错误:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 创建评论
router.post('/', async (req, res) => {
  const { article_id, content, parent_id, user_id } = req.body;
  try {
    const [result] = await db.query(
      'INSERT INTO comments (article_id, user_id, content, parent_id) VALUES (?, ?, ?, ?)',
      [article_id, user_id, content, parent_id || null]
    );
    
    // 返回新创建的评论
    const [newComment] = await db.query(`
      SELECT 
        c.*,
        a.title as article_title,
        (SELECT COUNT(*) FROM comments WHERE parent_id = c.id) as reply_count
      FROM comments c
      LEFT JOIN articles a ON c.article_id = a.id
      WHERE c.id = ?
    `, [result.insertId]);

    res.status(201).json({ 
      data: newComment[0],
      message: '评论创建成功' 
    });
  } catch (error) {
    console.error('创建评论错误:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 更新评论
router.put('/:id', verifyToken, async (req, res) => {
  const { content } = req.body;
  try {
    await db.query(
      'UPDATE comments SET content = ? WHERE id = ? AND user_id = ?',
      [content, req.params.id, req.user.id]
    );

    // 返回更新后的评论
    const [updatedComment] = await db.query(`
      SELECT 
        c.*,
        u.username,
        u.nickname,
        u.avatar
      FROM comments c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.id = ?
    `, [req.params.id]);

    res.json({ 
      data: updatedComment[0],
      message: '评论更新成功' 
    });
  } catch (error) {
    console.error('更新评论错误:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 删除评论
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    await db.query(
      'DELETE FROM comments WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    res.json({ message: '评论删除成功' });
  } catch (error) {
    console.error('删除评论错误:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

module.exports = router; 