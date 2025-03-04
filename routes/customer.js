const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../config/db');
const verifyToken = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth.js');

const router = express.Router();
const SALT_ROUNDS = 10;

// 获取用户列表
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    // 获取总数
    const [countResult] = await db.query('SELECT COUNT(*) as total FROM customer');
    const total = countResult[0].total;

    // 获取分页数据
    const [users] = await db.query(
      `SELECT id, username, email, phone, remark, created_at, last_login 
       FROM customer 
       LIMIT ? OFFSET ?`,
      [Number(limit), offset]
    );

    res.json({
      data: users,
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

// 获取单个用户
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT id, username, email, phone, remark, created_at, last_login FROM customer WHERE id = ?',
      [req.params.id]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ message: '用户不存在' });
    }
    
    res.json(users[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 创建用户
router.post('/', verifyToken, adminAuth, async (req, res) => {
  const { username, password, email, phone, remark } = req.body;
  
  try {
    // 检查用户名是否已存在
    const [existingUsers] = await db.query(
      'SELECT id FROM customer WHERE username = ?',
      [username]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({ message: '用户名已存在' });
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // 创建用户
    const [result] = await db.query(
      `INSERT INTO customer (username, password, email, phone, remark) 
       VALUES (?, ?, ?, ?, ?)`,
      [username, hashedPassword, email, phone, remark]
    );

    res.status(201).json({ 
      id: result.insertId,
      message: '用户创建成功'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 更新用户
router.put('/:id', verifyToken, adminAuth, async (req, res) => {
  const { email, phone, remark } = req.body;
  const { password } = req.body;

  try {
    let query = 'UPDATE customer SET email = ?, phone = ?, remark = ?';
    let params = [email, phone, remark];

    // 如果提供了新密码，则更新密码
    if (password) {
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
      query += ', password = ?';
      params.push(hashedPassword);
    }

    query += ' WHERE id = ?';
    params.push(req.params.id);

    await db.query(query, params);
    res.json({ message: '用户更新成功' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 删除用户
router.delete('/:id', verifyToken, adminAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM customer WHERE id = ?', [req.params.id]);
    res.json({ message: '用户删除成功' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: '服务器错误' });
  }
});

module.exports = router; 