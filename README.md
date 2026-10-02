# Sinh Tồn 2D: Frontend

Giao diện cho game battle royale 2D nhìn từ trên xuống, chơi được trên máy tính và điện thoại. Game vẽ bằng Phaser 4, menu viết bằng HTML/CSS, build bằng Vite và TypeScript, kết nối backend qua REST và Socket.IO.

## Chạy khi phát triển

Cần backend đang chạy ở `http://localhost:3001`.

```bash
npm install
npm run dev            # http://localhost:5173
```

Khi chạy dev, Vite chuyển tiếp `/api` và `/socket.io` sang `http://localhost:3001` nên không cần đặt biến môi trường. Nếu backend chạy ở chỗ khác thì tạo `.env.local` với `VITE_API_URL=<địa chỉ backend>`.

Kiểm tra kiểu: `npm run typecheck`.

## Deploy

Đây là web tĩnh, deploy được lên Vercel, Netlify, Cloudflare Pages, Nginx...

| Mục | Giá trị |
| --- | --- |
| Build | `npm ci && npm run build` |
| Output | `dist` |
| Biến môi trường | `VITE_API_URL` = địa chỉ backend, ví dụ `https://api.example.com` (không có `/` ở cuối) |

`VITE_API_URL` được gắn vào lúc build, nên đổi giá trị thì phải build lại. Bên backend phải thêm domain của frontend vào `CLIENT_ORIGIN`. Link mời có dạng `https://<domain>/?room=<uuid>`, nên không cần cấu hình chuyển hướng cho SPA.

Bản build hỗ trợ Chrome/Edge 80+, Firefox 78+, Safari/iOS 14+.

## Cấu trúc

```
src/app.ts          các màn hình menu: đăng nhập/đăng ký, sảnh, hàng chờ, phòng bạn bè, hồ sơ, lịch sử
src/api.ts          gọi REST, lưu token
src/net.ts          kết nối Socket.IO
src/settings.ts     cài đặt người chơi (lưu trong localStorage)
src/ui/panels.ts    hướng dẫn, danh sách vật phẩm, phím tắt, cài đặt
src/game/session.ts vòng input, dự đoán phía client, đối chiếu với server, nội suy
src/game/GameScene.ts  vẽ bản đồ, người chơi, mái nhà, khói, hiệu ứng (Phaser)
src/game/Hud.ts     thanh máu, ô vũ khí, kill feed, túi đồ, bản đồ, màn hình chết/kết thúc
src/game/Minimap.ts minimap và bản đồ lớn
src/game/Touch.ts   điều khiển cảm ứng
src/game/audio.ts   âm thanh tổng hợp bằng WebAudio
src/shared/         hằng số, vật phẩm, bản đồ, va chạm, giao thức mạng
```

`src/shared` có một bản giống hệt trong project backend. Hai bên dùng chung giao thức mạng, cùng sinh bản đồ từ một seed và cùng tính va chạm để dự đoán di chuyển, nên khi sửa một file trong `src/shared` thì phải sửa y hệt ở backend.

## Điều khiển

| Phím | Chức năng |
| --- | --- |
| W A S D | Di chuyển |
| Chuột / chuột trái | Ngắm / bắn, đánh, ném |
| R | Thay đạn |
| F | Nhặt đồ, mở cửa, mở thính |
| 1 / 2, E, V | Súng chính 1 / 2, súng lục, cận chiến |
| 3 / 4 | Lựu đạn / bom khói |
| Q hoặc 5 | Dùng túi cứu thương |
| Z | Đổi ống nhắm |
| Lăn chuột | Đổi vũ khí |
| Tab / M | Túi đồ / bản đồ lớn |
| Esc | Tạm dừng, cài đặt |

Trên điện thoại: cần điều khiển bên trái để di chuyển, cần điều khiển bên phải để ngắm (đẩy mạnh là bắn, thả tay ra là ném lựu đạn). Các nút nhặt, thay đạn, hồi máu, lựu đạn, khói nằm ở góc dưới bên phải; tạm dừng, ống nhắm, bản đồ, túi đồ nằm bên trái. Có thể bật/tắt và chỉnh cỡ điều khiển cảm ứng trong cài đặt.
