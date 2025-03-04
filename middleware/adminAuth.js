const verifyToken = require('./auth');

const adminAuth = (req, res, next) => {
  // 首先验证 token
  verifyToken(req, res, () => {
    // 检查用户是否是管理员
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ message: '没有权限' });
    }
    next();
  });
};

module.exports = adminAuth; 