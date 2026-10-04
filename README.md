# Project Undy (beta)

Web chat **1-1 với bạn bè**, giao diện tông đen. Không có group, không có server, chỉ có bạn và bạn bè của bạn.

**Chạy trên:** Vercel (hosting) + Neon PostgreSQL (database), cả hai đều có gói **miễn phí**.

---

## Tính năng

| | |
|---|---|
| Tài khoản | Đăng ký (có xác nhận mật khẩu), đăng nhập, mật khẩu được mã hoá |
| Bạn bè | Kết bạn bằng username, chấp nhận / từ chối / huỷ lời mời, huỷ kết bạn |
| Chat | Chỉ nhắn được với bạn bè, tin nhắn tự cập nhật mỗi ~2 giây |
| Trạng thái | Online, "đang nhập...", "Đã xem", số tin chưa đọc |
| Khác | Xoá tin nhắn của mình, tải tin nhắn cũ, dùng được trên điện thoại |

---

## Đưa lên mạng (3 bước, khoảng 10 phút)

### Bước 1: Đưa code lên GitHub

1. Vào https://github.com/new, đặt tên repo (ví dụ `project-undy`), bấm **Create repository**.
2. Bấm **uploading an existing file**.
3. Kéo **tất cả file và thư mục bên trong** thư mục code vào: `api`, `public`, `package.json`, `package-lock.json`, `vercel.json`, `dev-server.js`, `README.md`.
   > **Không** upload thư mục `node_modules` (nếu có).
4. Bấm **Commit changes**.

### Bước 2: Deploy lên Vercel

1. Vào https://vercel.com/new và đăng nhập bằng GitHub.
2. Chọn repo `project-undy`, bấm **Import**.
3. **Framework Preset** để **Other**, không đổi gì khác. Bấm **Deploy**.

> Lúc này web đã mở được nhưng **chưa đăng ký được**, vì chưa có database. Làm tiếp bước 3.

### Bước 3: Tạo database (PostgreSQL)

1. Mở project trên Vercel, vào tab **Storage**, bấm **Create Database**.
2. Chọn **Neon** (Serverless Postgres), chọn gói **Free**, rồi làm theo hướng dẫn.
3. Bấm **Connect** để nối database vào project `project-undy`.
   Vercel sẽ **tự thêm** biến `DATABASE_URL`. Bạn có thể kiểm tra ở **Settings → Environment Variables**.
4. Vào tab **Deployments**, bấm `...` ở bản mới nhất, chọn **Redeploy**.

**Xong!** Link web có dạng `https://project-undy-xxx.vercel.app`. Gửi link này cho bạn bè để họ đăng ký và kết bạn với bạn.

> Bảng dữ liệu tự tạo ở lần chạy đầu tiên, bạn không cần chạy lệnh SQL nào.

---

## Gặp lỗi?

| Hiện tượng | Cách xử lý |
|---|---|
| Đăng ký báo **"Lỗi máy chủ"** | Chưa có database hoặc chưa Redeploy. Làm lại bước 3. |
| Trang lỗi **404** khi đăng ký | Kiểm tra repo có file `vercel.json` và thư mục `api`. |
| Đã thêm database nhưng vẫn lỗi | Vào **Deployments** và **Redeploy** thêm một lần nữa. |

> Muốn dùng database ở chỗ khác (Supabase, Neon tự tạo...): copy chuỗi `postgres://...` vào **Settings → Environment Variables** với tên `DATABASE_URL`, rồi Redeploy.

---

## Sửa code sau này

Sửa file ngay trên GitHub (bấm biểu tượng bút chì) rồi Commit. Vercel sẽ **tự deploy lại** trong khoảng 1 phút.

---

## Chạy thử trên máy (không bắt buộc)

Cần **Node.js 20+** và một database PostgreSQL (có thể dùng luôn chuỗi kết nối Neon ở bước 3).

```bash
npm install

# Windows (PowerShell)
$env:DATABASE_URL="postgres://..." ; npm run dev

# macOS / Linux
DATABASE_URL="postgres://..." npm run dev
```

Mở http://localhost:3000

---

## Cấu trúc thư mục

```
api/index.js        Toàn bộ API (Express), chạy thành serverless function trên Vercel
public/index.html   Giao diện (HTML/CSS/JS thuần)
vercel.json         Chuyển mọi đường dẫn /api/* vào api/index.js
dev-server.js       Chỉ dùng khi chạy trên máy
```

**Biến môi trường:** `DATABASE_URL` (hoặc `POSTGRES_URL`). Neon tự thêm khi Connect trên Vercel.
