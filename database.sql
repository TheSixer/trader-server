CREATE DATABASE IF NOT EXISTS trader_db;
USE trader_db;

CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  is_root BOOLEAN DEFAULT FALSE,
  status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  nickname VARCHAR(255),
  avatar VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  email VARCHAR(255),
  phone VARCHAR(20),
  role ENUM('admin', 'editor', 'user') DEFAULT 'user',
  last_login TIMESTAMP,
  description TEXT
);

CREATE TABLE categories (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(50) NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE articles (
  id INT PRIMARY KEY AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  user_id INT,
  category_id INT,
  views INT DEFAULT 0,
  likes INT DEFAULT 0,
  tags VARCHAR(255),  -- 直接存储标签文字，用逗号分隔
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_recommended BOOLEAN DEFAULT FALSE,
  is_top BOOLEAN DEFAULT FALSE,
  cover_image VARCHAR(255),
  summary TEXT,
  sort_order INT DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE comments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  content TEXT NOT NULL,
  user_id VARCHAR(50),  -- 修改为 VARCHAR，存储任意唯一标识
  article_id INT,
  parent_id INT DEFAULT NULL,
  likes INT DEFAULT 0,  -- 点赞数
  dislikes INT DEFAULT 0,  -- 踩数
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
);

-- 创建root用户
INSERT INTO users (username, password, is_root, status, role) 
VALUES (
  'root', 
  '$2b$10$slyW/7g3COXAolEiwJmfuuLHoCyU.xVoFjd5zIibIjOLZ9Yi7T/Im', 
  TRUE, 
  'approved',
  'admin'
); 

-- 添加索引以提高查询性能
CREATE INDEX idx_articles_recommended ON articles(is_recommended);
CREATE INDEX idx_articles_top ON articles(is_top);
CREATE INDEX idx_articles_sort ON articles(sort_order); 