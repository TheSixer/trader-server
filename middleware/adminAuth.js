const jwt = require('jsonwebtoken');
const db = require('../config/db');

const adminAuth = async (req, res, next) => {
  try {
    // 从请求头获取 token
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: '未授权访问' });
    }

    // 验证 token 并获取用户信息
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.id;

    // 查询用户角色
    const [users] = await db.query(
      'SELECT role FROM users WHERE id = ?',
      [userId]
    );
    
    if (users.length === 0 || users[0].role !== 'admin') {
      return res.status(403).json({ message: '需要管理员权限' });
    }
    
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'token无效' });
    }
    console.error(error);
    res.status(500).json({ message: '服务器错误' });
  }
};

module.exports = adminAuth; 