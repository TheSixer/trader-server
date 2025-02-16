import express from 'express';
import db from '../config/db.js';
import verifyToken from '../middleware/auth.js';
import adminAuth from '../middleware/adminAuth.js';

const router = express.Router();

// 获取分类列表
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    // 获取总数
    const [countResult] = await db.query('SELECT COUNT(*) as total FROM categories');
    const total = countResult[0].total;

    // 获取分页数据
    const [categories] = await db.query(
      `SELECT * FROM categories ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [Number(limit), offset]
    );

    res.json({
      data: categories,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 获取单个分类
router.get('/:id', async (req, res) => {
  try {
    const [categories] = await db.query(
      'SELECT * FROM categories WHERE id = ?',
      [req.params.id]
    );

    if (categories.length === 0) {
      return res.status(404).json({ message: '分类不存在' });
    }

    res.json(categories[0]);
  } catch (error) {
    console.error('获取分类详情错误:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 创建分类
router.post('/', verifyToken, adminAuth, async (req, res) => {
  const { name, description } = req.body;
  
  try {
    const [result] = await db.query(
      'INSERT INTO categories (name, description) VALUES (?, ?)',
      [name, description]
    );
    
    res.status(201).json({ 
      id: result.insertId,
      message: '分类创建成功'
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: '分类名称已存在' });
    }
    console.error(error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 更新分类
router.put('/:id', verifyToken, adminAuth, async (req, res) => {
  const { name, description } = req.body;
  
  try {
    await db.query(
      'UPDATE categories SET name = ?, description = ? WHERE id = ?',
      [name, description, req.params.id]
    );
    res.json({ message: '分类更新成功' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: '分类名称已存在' });
    }
    console.error(error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 删除分类
router.delete('/:id', verifyToken, adminAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM categories WHERE id = ?', [req.params.id]);
    res.json({ message: '分类删除成功' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: '服务器错误' });
  }
});

export default router; 