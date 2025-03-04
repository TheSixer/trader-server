const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const db = require('../config/db');
const verifyToken = require('../middleware/auth');

const router = express.Router();
const SALT_ROUNDS = 10;

// 注册
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    // 检查用户名是否已存在
    const [existingUsers] = await db.query(
      'SELECT id FROM users WHERE username = ?',
      [username]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({ message: '用户名已存在' });
    }

    // 对密码进行加密
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // 创建新用户
    const [result] = await db.query(
      'INSERT INTO users (username, password) VALUES (?, ?)',
      [username, hashedPassword]
    );

    res.status(201).json({ 
      message: '注册申请已提交，请等待管理员审批',
      userId: result.insertId 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 登录
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const [users] = await db.query(
      'SELECT * FROM users WHERE username = ? AND status = "approved"',
      [username]
    );


    if (users.length === 0) {
      return res.status(401).json({ message: '用户名不存在或账号未通过审批' });
    }

    // 验证密码
    const isValidPassword = await bcrypt.compare(password, users[0].password);
    
    if (!isValidPassword) {
      return res.status(401).json({ message: '密码错误' });
    }

    const token = jwt.sign(
      { id: users[0].id, username: users[0].username, role: users[0].role, isRoot: users[0].is_root },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 获取待审批用户列表（仅root可访问）
router.get('/pending-users', verifyToken, async (req, res) => {
  try {
    // 验证是否是root用户
    if (!req.user.isRoot) {
      return res.status(403).json({ message: '无权限访问' });
    }

    const [users] = await db.query(
      'SELECT id, username, created_at, status FROM users WHERE status = "pending"'
    );

    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 审批用户（仅root可访问）
router.put('/approve/:userId', verifyToken, async (req, res) => {
  const { status } = req.body; // status可以是 'approved' 或 'rejected'
  const { userId } = req.params;

  try {
    // 验证是否是root用户
    if (!req.user.isRoot) {
      return res.status(403).json({ message: '无权限访问' });
    }

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ message: '无效的状态值' });
    }

    await db.query(
      'UPDATE users SET status = ? WHERE id = ?',
      [status, userId]
    );

    res.json({ message: `用户审批${status === 'approved' ? '通过' : '拒绝'}成功` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: '服务器错误' });
  }
});

module.exports = router; 