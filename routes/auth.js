const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const cors = require('cors');
const db = require('../config/db');
const verifyToken = require('../middleware/auth');

const router = express.Router();
const SALT_ROUNDS = 10;

// 移除详细的 CORS 配置
router.use(cors());  // 使用默认配置

// 注册
router.post('/register', async (req, res) => {
  const { 
    username, 
    password, 
    nickname = '', 
    email = null, 
    phone = null,
    avatar = null 
  } = req.body;

  // 参数验证
  if (!username || !password) {
    return res.status(400).json({ message: '用户名和密码不能为空' });
  }

  // 参数验证
  if (!email) {
    return res.status(400).json({ message: '邮箱不能为空' });
  }

  // 参数验证
  if (!phone) {
    return res.status(400).json({ message: '手机号不能为空' });
  }

  try {
    // 检查用户名是否已存在
    const [existingUsers] = await db.query(
      'SELECT id FROM customer WHERE username = ?',
      [username]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({ message: '用户名已存在' });
    }

    // 对密码进行加密
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // 创建新用户
    const [result] = await db.query(
      `INSERT INTO customer 
      (username, password, nickname, email, phone, avatar, last_login) 
      VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        username, 
        hashedPassword, 
        nickname, 
        email, 
        phone, 
        avatar || '/default-avatar.png'
      ]
    );

    // 生成 JWT
    const token = jwt.sign(
      { 
        id: result.insertId, 
        username: username,
        nickname: nickname
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({ 
      message: '注册成功',
      userId: result.insertId,
      token: token,
      userInfo: {
        id: result.insertId,
        username,
        nickname,
        email,
        phone,
        avatar: avatar || '/default-avatar.png'
      }
    });
  } catch (error) {
    console.error('注册错误:', error);
    res.status(500).json({ 
      message: '服务器错误',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 登录
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const [users] = await db.query(
      'SELECT * FROM customer WHERE username = ?',
      [username]
    );

    if (users.length === 0) {
      return res.json({ code: 401, message: '用户名不存在' });
    }

    const user = users[0];

    // 验证密码
    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (!isValidPassword) {
      return res.json({ code: 401, message: '密码错误' });
    }

    // 更新最后登录时间
    await db.query(
      'UPDATE customer SET last_login = NOW() WHERE id = ?',
      [user.id]
    );

    // 生成 JWT
    const token = jwt.sign(
      { 
        id: user.id, 
        username: user.username,
        nickname: user.nickname
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ 
      token,
      userInfo: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        email: user.email,
        phone: user.phone,
        avatar: user.avatar
      }
    });
  } catch (error) {
    console.error('登录错误:', error);
    res.status(500).json({ 
      message: '服务器错误',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 更新用户信息
router.put('/profile', verifyToken, async (req, res) => {
  const userId = req.user.id;
  const { 
    nickname, 
    email, 
    phone, 
    avatar,
    remark 
  } = req.body;

  try {
    await db.query(
      `UPDATE customer 
       SET nickname = ?, email = ?, phone = ?, avatar = ?, remark = ?
       WHERE id = ?`,
      [
        nickname, 
        email, 
        phone, 
        avatar || '/default-avatar.png', 
        remark,
        userId
      ]
    );

    res.json({ 
      message: '用户信息更新成功',
      userInfo: { 
        nickname, 
        email, 
        phone, 
        avatar: avatar || '/default-avatar.png',
        remark
      }
    });
  } catch (error) {
    console.error('更新用户信息错误:', error);
    res.status(500).json({ 
      message: '服务器错误',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 添加一个获取用户信息的接口
router.get('/user-info', verifyToken, async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT id, username, nickname, email, phone, avatar FROM customer WHERE id = ?',
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: '用户不存在' });
    }

    res.json(users[0]);
  } catch (error) {
    console.error('获取用户信息错误:', error);
    res.status(500).json({ 
      message: '服务器错误',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router; 