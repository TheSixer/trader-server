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
    const [countResult] = await db.query('SELECT COUNT(*) as total FROM users');
    const total = countResult[0].total;

    // 获取分页数据
    const [users] = await db.query(
      `SELECT id, username, email, phone, role, status, created_at, last_login 
       FROM users 
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
      'SELECT id, username, email, phone, role, status, description, created_at, last_login FROM users WHERE id = ?',
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
  const { username, password, email, phone, role, description } = req.body;
  
  try {
    // 检查用户名是否已存在
    const [existingUsers] = await db.query(
      'SELECT id FROM users WHERE username = ?',
      [username]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({ message: '用户名已存在' });
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // 创建用户
    const [result] = await db.query(
      `INSERT INTO users (username, password, email, phone, role, description, status) 
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [username, hashedPassword, email, phone, role, description]
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
  const { email, phone, role, description, status } = req.body;
  const { password } = req.body;

  try {
    let query = 'UPDATE users SET email = ?, phone = ?, role = ?, description = ?';
    let params = [email, phone, role, description];

    // 如果提供了新密码，则更新密码
    if (password) {
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
      query += ', password = ?';
      params.push(hashedPassword);
    }

    if (status) {
      query += ', status = ?';
      params.push(status);
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
    await db.query('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ message: '用户删除成功' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 更新用户状态
router.patch('/:id/status', verifyToken, adminAuth, async (req, res) => {
  const { status } = req.body;
  
  try {
    await db.query(
      'UPDATE users SET status = ? WHERE id = ?',
      [status, req.params.id]
    );
    res.json({ message: '用户状态更新成功' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: '服务器错误' });
  }
});

module.exports = router; 