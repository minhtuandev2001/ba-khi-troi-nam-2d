# Bá Khí - Trời Nam 2D: Frontend

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

Bảo mật: lúc build, Vite chèn thẻ `Content-Security-Policy` vào `index.html`, chỉ cho chạy script của chính trang và chỉ cho kết nối tới backend trong `VITE_API_URL`. Khi chạy dev thì không có CSP. Các header không đặt được bằng thẻ meta (chống nhúng iframe, HSTS, nosniff...) nằm trong `public/_headers` (Netlify, Cloudflare Pages) và `vercel.json` (Vercel). Dùng Nginx thì chép các header đó vào cấu hình. Muốn kiểm tra CSP trước khi deploy thì chạy `npm run build && npx vite preview`.

Chặn công cụ nhà phát triển (`src/ui/devtoolsGuard.ts`), áp dụng cho người chưa đăng nhập và người chơi thường, tài khoản admin không bị chặn:

- Ngay từ lúc trang tải (cả khi đang chờ server), chặn menu chuột phải (cả nhấn giữ trên điện thoại, phím Menu và Shift+F10), F12, Ctrl+Shift+I/J/C/K/E/M/A/Z và Cmd+Option+… trên macOS (các bảng của Chrome, Edge, Firefox, Safari), Shift+F7/F9 (Firefox), Ctrl+U (xem mã nguồn), Ctrl+S (lưu trang).
- Nếu công cụ vẫn được mở từ menu trình duyệt, mở sẵn từ trước khi vào trang, tách thành cửa sổ riêng hay gỡ lỗi từ xa trên điện thoại, trang phát hiện bằng hai cách: lệnh `debugger` (công cụ mở thì lệnh dừng lại) và đo thời gian `console.table` (vẫn phát hiện được khi đã tắt breakpoint). Khi phát hiện, trang ngắt kết nối game và hiện màn chặn, gỡ màn chặn đi thì nó tự hiện lại; phải đóng công cụ rồi tải lại trang.
- Mặc định bật cả khi chạy dev. Đặt `VITE_DEVTOOLS_GUARD=off` trong `.env.local` để tắt hẳn. `vite.config.ts` giữ lại lệnh `debugger` khi minify (`dropDebugger: false`).
- Đây chỉ là rào cản với người tò mò. Không chặn được: gõ `view-source:` trên thanh địa chỉ, Shift + chuột phải trên Firefox (menu vẫn hiện, nhưng mở công cụ ra sẽ bị phát hiện), tiện ích trình duyệt, proxy bắt gói tin, tắt JavaScript, gọi thẳng API. Vì vậy mọi luật quan trọng vẫn do server kiểm tra.

Công cụ cho admin (server kiểm tra quyền, người thường không thấy và không gọi được):

- Danh sách phòng ở sảnh có thêm tab **Đang đấu**: các trận ghép, đấu bot, phòng bạn bè đang diễn ra (tên phòng hoặc chế độ, bản đồ, kiểu đội, số còn sống, số người thật và bot, thời gian đã đấu hoặc "Phòng chờ", số admin đang xem), tự cập nhật vài giây một lần. Bấm vào một trận để vào xem.
- Khi xem trận, admin chỉ quan sát qua góc nhìn của một người chơi (không điều khiển, không nhặt, không ai thấy admin). Thanh trên cùng có: tên người đang xem, ◀ / ▶ (hoặc ← → / A D) để đổi người, **Kích khỏi trận** (bấm hai lần trong 3 giây để xác nhận, chỉ kích người đang hiện trên màn hình) và **Rời xem**. Lúc phòng chờ đầu trận còn mở thì thanh này nằm ngay dưới bảng phòng chờ.
- Người bị kích về sảnh với thông báo "Bạn đã bị admin kích khỏi trận đấu."; mọi người trong trận thấy "<tên> đã bị admin kích khỏi map" ở giữa màn hình và bảng hạ gục.
- **Cấm chat:** tìm tên người chơi ở tab Bạn bè rồi bấm 🔇 (cạnh 🛡️ Nhắn), chọn 15 phút, 1 giờ, 1 ngày, 7 ngày, hoặc **Bỏ cấm chat** nếu người đó đang bị cấm. Kết quả tìm kiếm hiện "🔇 Bị cấm chat đến ..." dưới tên người đang bị cấm (chỉ admin thấy). Người bị cấm nhận thông báo nổi kèm thời hạn, không gửi được kênh thế giới và tin nhắn riêng nhưng vẫn nhắn được ở tab 🛡️ Admin; bỏ cấm thì cũng được báo.

Chat hỗ trợ (tab thứ ba trong khung chat):

- Người chơi thường thấy tab **🛡️ Admin**: nhắn thẳng cho đội quản trị mà không cần kết bạn. Dòng trên cùng báo đang có admin online hay không; tin admin trả lời có số đếm trên tab và nút chat, kèm thông báo nổi khi đang ở tab khác.
- Admin thấy tab **🛡️ Hộp thư**: danh sách người chơi đã nhắn (tin cuối, giờ, số tin chưa đọc, trạng thái online), bấm vào để mở cuộc trò chuyện và trả lời. Mọi admin cùng thấy một cuộc trò chuyện. Muốn nhắn trước cho ai thì tìm tên ở tab Bạn bè rồi bấm **🛡️ Nhắn**.

Bản quyền: dự án dùng giấy phép độc quyền trong `LICENSE` ở thư mục gốc. Mỗi file JS khi build có dòng `/*! © 2026 Bá Khí - Trời Nam 2D. All rights reserved... */` ở đầu, và console của trình duyệt in thông báo bản quyền kèm cảnh báo lừa dán mã (`src/license.ts`).

## Cấu trúc

```
src/app.ts          các màn hình menu: đăng nhập/đăng ký, sảnh (kèm danh sách phòng đang mở bên trái: trên máy tính là panel cố định ở mép trái giống khung chat bên phải, tablet và điện thoại nằm cùng các thẻ chế độ; admin có thêm tab trận đang đấu; và hộp thoại tạo phòng có tên), hàng chờ, phòng bạn bè, hồ sơ (kèm lịch sử trận)
src/license.ts      thông báo bản quyền in ra console
src/ui/devtoolsGuard.ts  chặn công cụ nhà phát triển với người không phải admin
src/ui/names.ts     hiển thị tên người chơi; tài khoản admin có tên mạ vàng và huy hiệu "Quản trị"
src/api.ts          gọi REST, lưu token
src/net.ts          kết nối Socket.IO
src/settings.ts     cài đặt người chơi (lưu trong localStorage)
src/ui/panels.ts    hướng dẫn, danh sách vật phẩm, phím tắt, cài đặt
src/ui/components.css  design system: component dùng chung tiền tố ui-* (panel, tab, nút icon, hàng, avatar, badge), dùng token trong :root của style.css
src/social/SocialClient.ts  trạng thái chat/bạn bè và API socket
src/social/SocialPanel.ts   khung chat nổi: kênh thế giới, bạn bè, tìm kiếm kết bạn, chat riêng, tab chat hỗ trợ với admin (tin của admin có khung đỏ son viền vàng), nút cấm chat của admin
src/game/session.ts vòng input, dự đoán phía client, đối chiếu với server, nội suy; chế độ admin xem trận (không gửi input)
src/game/GameScene.ts  vẽ bản đồ, người chơi, mái nhà, khói, hiệu ứng (Phaser)
src/game/Hud.ts     thanh máu, ô vũ khí, kill feed, túi đồ, bản đồ, màn hình chết/kết thúc
src/game/Minimap.ts minimap và bản đồ lớn, cờ đánh dấu và đường nét đứt tới cờ
src/game/Touch.ts   điều khiển cảm ứng
src/game/audio.ts   âm thanh tổng hợp bằng WebAudio (không dùng file), có âm thanh môi trường và nhạc nền ngoài trận
src/game/icons.ts   biểu tượng vật phẩm vẽ bằng SVG và bảng độ hiếm
src/shared/         hằng số, vật phẩm, bản đồ, va chạm, giao thức mạng
```

`src/shared` có một bản giống hệt trong project backend. Hai bên dùng chung giao thức mạng, cùng dựng bản đồ từ mã bản đồ (`maps.ts`) và cùng tính va chạm để dự đoán di chuyển, nên khi sửa một file trong `src/shared` thì phải sửa y hệt ở backend.

## Điều khiển

| Phím | Chức năng |
| --- | --- |
| W A S D | Di chuyển |
| Chuột / chuột trái | Ngắm / bắn, đánh, ném |
| Chuột phải | Nhặt món đang trỏ chuột, không trỏ thì nhặt món gần nhất trong tầm (đồ trong tầm có nền sáng) |
| R | Nạp tên |
| F | Nhặt đồ, mở cửa, mở thính |

Tự nhặt tên, thuốc nam, hũ lửa, bầu khói và chim khi đi qua là tuỳ chọn trong cài đặt (`autoPickup`, mặc định tắt); client gửi lựa chọn này cho server bằng action `autoPickup` khi vào trận và mỗi lần đổi.
| 1 / 2, E, V | Vũ khí chính 1 / 2, ống thổi, cận chiến |
| 3 / 4 | Hũ lửa / bầu khói |
| Q hoặc 5 | Đắp thuốc nam |
| Z | Đổi chim trinh sát |
| Lăn chuột | Đổi vũ khí |
| Tab / M | Túi đồ / bản đồ lớn |
| Esc | Tạm dừng, cài đặt |

Trên điện thoại và máy tính bảng: cần điều khiển bên trái để di chuyển, cần điều khiển bên phải để ngắm (đẩy mạnh là bắn, thả tay ra là ném hũ lửa). Điều khiển cảm ứng tự hiện trên điện thoại và máy tính bảng (máy tính dùng bàn phím và chuột), cỡ nút chỉnh được trong cài đặt. Vị trí nút nằm trong `style.css` (class `t-<tên nút>`), `Touch.ts` chỉ đặt cỡ nút.

- **Điện thoại phải cầm ngang.** Cầm dọc trong trận thì hiện thẻ "Xoay ngang điện thoại để chơi" che trận (trận vẫn chạy, xoay ngang là chơi tiếp).
- **Toàn màn hình** (`src/ui/fullscreen.ts`, chỉ trên điện thoại có hỗ trợ, tức Android): trình duyệt chỉ cho bật ngay trong lúc người chơi bấm, nên trang bật toàn màn hình khi bấm nút dẫn vào trận (Tìm trận, chọn bản đồ đấu bot, Vào tập bắn, trưởng nhóm bấm Tìm trận, chủ phòng bấm Bắt đầu). Vào trận thì khoá màn hình nằm ngang. Ai vào trận mà không tự bấm (thành viên phòng, thành viên nhóm) thì được bật ở lần chạm đầu tiên trong trận, hoặc bằng nút trên thẻ nhắc xoay. Rời trận, huỷ tìm trận hay rời phòng/nhóm về sảnh thì thoát toàn màn hình (chỉ khi do game bật). iPhone không cho trang web bật toàn màn hình hay khoá xoay nên chỉ nhắc xoay.
- **Bố cục khi cầm ngang:** tạm dừng, chim trinh sát, bản đồ, túi đồ xếp thành một hàng ở góc trên bên trái. Nhặt, nạp tên, thuốc nam, bầu khói, hũ lửa ôm góc dưới bên phải thành hình chữ L, chừa phần bên trong cho cần ngắm. Thanh máu và ô vũ khí thu gọn ở giữa cạnh dưới (ô có vũ khí chỉ hiện icon và số tên). Dải chọn chim được ẩn (đổi chim bằng nút chim), bảng hạ gục chỉ hiện 3 dòng mới nhất.
- **Máy tính bảng** chơi được cả dọc lẫn ngang với bố cục cũ: các nút hành động ở góc dưới bên phải, các nút công cụ xếp dọc bên trái.
