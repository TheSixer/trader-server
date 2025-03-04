const express = require('express');
const cors = require('cors');
const { config } = require('dotenv');
const path = require('path');

const authRoutes = require('./routes/auth');
const adminAuthRoutes = require('./routes/adminAuth');
const articleRoutes = require('./routes/articles');
const commentRoutes = require('./routes/comments');
const uploadRoutes = require('./routes/upload');
const userRoutes = require('./routes/users');
const categoryRoutes = require('./routes/categories');
const surveyRoutes = require('./routes/survey');
const customerRoutes = require('./routes/customer');

// 检查是否有 adminAuth 中间件
const adminAuth = require('./middleware/adminAuth');

config();

const app = express();

// 更宽松的 CORS 配置
const corsOptions = {
  origin: function (origin, callback) {
    // 允许所有域名
    callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  maxAge: 3600
};

// 使用全局 CORS 中间件
app.use(cors(corsOptions));

// 处理 OPTIONS 预检请求的中间件
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    return res.status(200).end();
  }
  next();
});

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 路由
app.use('/api/auth', authRoutes);
app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/posts', articleRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/users', userRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/survey', surveyRoutes);
app.use('/api/customers', customerRoutes);

// 静态文件服务
app.use('/reports', express.static(path.join(__dirname, 'reports')));

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    message: '服务器错误',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = process.env.PORT || 3010;
app.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
}); 