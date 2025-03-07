const mysql = require('mysql2');
const { config } = require('dotenv');

config();

// 创建连接池配置
const poolConfig = {
  host: process.env.DB_HOST,
  port: 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // 只保留支持的超时设置
  connectTimeout: 60000, // 连接超时时间，60秒
};

// 创建连接池
const pool = mysql.createPool(poolConfig);
const promisePool = pool.promise();

// 添加连接池错误处理
pool.on('error', (err) => {
  console.error('数据库连接池错误:', err);
  if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ETIMEDOUT') {
    console.log('尝试重新连接数据库...');
    // 在生产环境中可能需要更复杂的重连逻辑
  }
});

// 修改：使用 promisePool 而不是 pool 进行心跳检测
setInterval(async () => {
  try {
    await promisePool.query('SELECT 1');
    console.log('数据库连接心跳正常');
  } catch (err) {
    console.error('数据库心跳检测失败:', err);
  }
}, 30000); // 每30秒执行一次

module.exports = promisePool; 