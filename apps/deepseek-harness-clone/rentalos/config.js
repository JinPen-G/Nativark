/* 生产部署时填入实际 HTTPS API 前缀（含 /api），不要填写管理员密钥。
   GitHub Pages 与 API 不同源：后端 CORS_ALLOWED_ORIGINS 需加入官网 origin。
   留空仅在本机 HTTP 预览时使用 http://127.0.0.1:3000/api；线上留空会明确报错。 */
window.RentalOSWebsiteConfig = Object.freeze({ apiBaseUrl: "" });
