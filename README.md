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

Mã QR mời vào phòng (`src/ui/qr.ts`, thư viện `uqr` chỉ tải khi bấm nút): trong phòng chờ, nút **📱 Hiện mã QR cho người khác quét** mở hộp thoại có mã QR của link mời (kèm tên phòng, mã phòng, nút sao chép link). Người khác quét bằng camera điện thoại là mở link, chưa có tài khoản thì đăng ký xong tự vào phòng. Điện thoại cầm ngang thì mã QR nằm bên trái, chữ bên phải để vừa màn hình. Hộp thoại vẫn mở khi có người vào/ra phòng, tự đóng khi rời phòng hoặc trận bắt đầu. Link lấy theo địa chỉ trang đang mở, nên khi chạy dev bằng `localhost` thì máy khác quét sẽ không vào được (hộp thoại có cảnh báo): mở trang bằng IP mạng LAN của máy (dev server đã bật `host: true`, ví dụ `http://192.168.1.5:5173`; nếu backend từ chối kết nối thì thêm địa chỉ đó vào `CLIENT_ORIGIN`) hoặc dùng bản đã deploy.

Bản build hỗ trợ Chrome/Edge 80+, Firefox 78+, Safari/iOS 14+.

Bảo mật: lúc build, Vite chèn thẻ `Content-Security-Policy` vào `index.html`, chỉ cho chạy script của chính trang và chỉ cho kết nối tới backend trong `VITE_API_URL`. Khi chạy dev thì không có CSP. Các header không đặt được bằng thẻ meta (chống nhúng iframe, HSTS, nosniff...) nằm trong `public/_headers` (Netlify, Cloudflare Pages) và `vercel.json` (Vercel). Dùng Nginx thì chép các header đó vào cấu hình. Muốn kiểm tra CSP trước khi deploy thì chạy `npm run build && npx vite preview`.

Chặn công cụ nhà phát triển (`src/ui/devtoolsGuard.ts`), áp dụng cho người chưa đăng nhập và người chơi thường, tài khoản admin không bị chặn:

- Ngay từ lúc trang tải (cả khi đang chờ server), chỉ chặn hai thao tác: **chuột phải** (menu chuột phải, cả phím Menu và Shift+F10) và **phím F12**. Khi người dùng làm một trong hai, trang hiện thông báo "Thao tác không khả dụng", bấm "Đã hiểu" hoặc Esc để đóng. Thông báo không ngắt kết nối và không bắt tải lại trang.
- Chuột phải trên màn chơi (là phím nhặt đồ) và nhấn giữ trên điện thoại, máy tính bảng chỉ bị chặn menu trình duyệt, không hiện thông báo.
- Không còn phát hiện công cụ đang mở bằng cách đo thời gian (cách đó báo nhầm trên điện thoại và máy tính bảng). Các phím tắt khác (Ctrl+Shift+I, Ctrl+U...) và mở từ menu trình duyệt không bị chặn.
- Mặc định bật cả khi chạy dev. Đặt `VITE_DEVTOOLS_GUARD=off` trong `.env.local` để tắt hẳn.
- Đây chỉ là rào cản với người tò mò. Mọi luật quan trọng vẫn do server kiểm tra.

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
src/app.ts          các màn hình menu: đăng nhập/đăng ký, sảnh (kèm danh sách phòng đang mở bên trái: trên máy tính là panel cố định ở mép trái giống khung chat bên phải, tablet và điện thoại nằm cùng các thẻ chế độ; admin có thêm tab trận đang đấu; và hộp thoại tạo phòng có tên), hàng chờ, phòng bạn bè (kèm mã QR mời), trang chỉnh nút cảm ứng, hồ sơ (kèm lịch sử trận)
src/ui/qr.ts        hộp thoại mã QR của link mời vào phòng
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
src/game/Touch.ts   điều khiển cảm ứng và trình chỉnh nút (trong trận, hoặc chế độ xem trước mở từ sảnh)
src/ui/touchLayout.ts  bố cục nút cảm ứng: bản sao trong trình duyệt, đồng bộ với tài khoản
src/game/audio.ts   âm thanh tổng hợp bằng WebAudio (không dùng file): hiệu ứng, âm thanh môi trường, nhạc sảnh và nhạc riêng của từng bản đồ trong trận
src/ui/orientation.ts  máy tính bảng tự xoay ngang ở mọi trang
src/game/icons.ts   biểu tượng vật phẩm vẽ bằng SVG và bảng độ hiếm
src/shared/         hằng số, vật phẩm, bản đồ, va chạm, giao thức mạng, kiểm tra bố cục nút cảm ứng
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

Trên điện thoại và máy tính bảng: cần điều khiển bên trái để di chuyển, cần điều khiển bên phải chỉ để xoay người. Bắn bằng nút bắn riêng (`t-fire`, vòng ngắm viền đỏ, to gấp rưỡi nút thường) nằm cùng bên trái với cần di chuyển, phía trên và lệch vào trong chỗ ngón cái trái đặt: giữ là bắn liên tục. Đang cầm hũ lửa hay bầu khói thì thả nút bắn là ném; tầm ném theo độ kéo của cần xoay lúc thả (không kéo thì 60% tầm tối đa). Không giữ cần xoay mà vừa đi vừa bắn thì bắn theo hướng đi. Nút bắn dời chỗ và đổi cỡ được trong trình chỉnh nút như các nút khác. Điều khiển cảm ứng tự hiện trên điện thoại và máy tính bảng (máy tính dùng bàn phím và chuột), cỡ chung của mọi nút chỉnh được trong cài đặt. Vị trí mặc định của nút nằm trong `style.css` (class `t-<tên nút>`).

- **Điện thoại phải cầm ngang.** Cầm dọc trong trận thì hiện thẻ "Xoay ngang điện thoại để chơi" che trận (trận vẫn chạy, xoay ngang là chơi tiếp).
- **Toàn màn hình** (`src/ui/fullscreen.ts`, chỉ trên điện thoại có hỗ trợ, tức Android): trình duyệt chỉ cho bật ngay trong lúc người chơi bấm, nên trang bật toàn màn hình khi bấm nút dẫn vào trận (Tìm trận, chọn bản đồ đấu bot, Vào tập bắn, trưởng nhóm bấm Tìm trận, chủ phòng bấm Bắt đầu). Vào trận thì khoá màn hình nằm ngang. Ai vào trận mà không tự bấm (thành viên phòng, thành viên nhóm) thì được bật ở lần chạm đầu tiên trong trận, hoặc bằng nút trên thẻ nhắc xoay. Rời trận, huỷ tìm trận hay rời phòng/nhóm về sảnh thì thoát toàn màn hình (chỉ khi do game bật). iPhone không cho trang web bật toàn màn hình hay khoá xoay nên chỉ nhắc xoay.
- **Bố cục khi cầm ngang:** tạm dừng, chim trinh sát, bản đồ, túi đồ xếp thành một hàng ở góc trên bên trái. Nhặt, nạp tên, thuốc nam, bầu khói, hũ lửa ôm góc dưới bên phải thành hình chữ L, chừa phần bên trong cho cần xoay. Nút bắn ở nửa trái, phía trên cần di chuyển. Thanh máu và ô vũ khí thu gọn ở giữa cạnh dưới (ô có vũ khí chỉ hiện icon và số tên). Dải chọn chim được ẩn (đổi chim bằng nút chim), bảng hạ gục chỉ hiện 3 dòng mới nhất.
- **Máy tính bảng tự xoay ngang ở mọi trang** (sảnh, phòng, hồ sơ, trận đấu...), không cần bấm nút (`src/ui/orientation.ts`, gọi từ `main.ts`). "Máy tính bảng" được xác định theo kích thước hiển thị hiện tại của trang: thiết bị cảm ứng (con trỏ thô), không phải cỡ điện thoại (rộng trên 600px và cao trên 500px) và không quá cỡ màn hình máy tính (cả hai chiều tối đa 1500px), xem `isTablet` trong `src/ui/fullscreen.ts`; kiểm tra lại mỗi khi trang đổi kích thước (`body.tablet-ui`). Điện thoại và máy tính giữ nguyên như cũ.
  - Trình duyệt chỉ cho khoá xoay trong lúc người dùng chạm, và Android cần bật toàn màn hình mới khoá được, nên lần chạm đầu tiên ở bất kỳ đâu trên trang sẽ bật toàn màn hình và khoá ngang (`screen.orientation.lock('landscape')`). Rời trận không bỏ khoá này.
  - Khi máy tính bảng đang cầm dọc mà chưa khoá được (Safari trên iPad không cho trang web xoay, hoặc người chơi đã thoát toàn màn hình), thẻ "Xoay ngang máy tính bảng" che trang. Thẻ có nút "Xoay ngang" (chỉ hiện khi trình duyệt có hỗ trợ khoá; bị từ chối thì thẻ nhắc tự xoay máy) và nút "Vẫn dùng màn hình dọc" để ẩn thẻ đến hết lần truy cập này (`sessionStorage` khoá `br2d_portrait_ok`). Chạm vào nút này không kích hoạt khoá tự động.
  - Bố cục nút trong trận của máy tính bảng giữ như cũ: các nút hành động ở góc dưới bên phải, các nút công cụ xếp dọc bên trái.
- **Tự chỉnh nút**, ngoài trận có **trang Chỉnh nút** riêng (màn `controls` trong `src/app.ts`): mở bằng nút "🎛️ Chỉnh nút" trên thanh điều hướng (thiết bị cảm ứng thấy nút này thay cho "Phím tắt"), hoặc nút "Chỉnh vị trí và cỡ từng nút" trong Cài đặt. Trang vẽ phác màn hình trận theo đúng cỡ HUD thật (bản đồ nhỏ, thanh máu, ô vũ khí, vùng cần di chuyển và cần ngắm) để thấy nút có che gì không; Lưu hoặc Huỷ thì quay lại trang vừa mở nó, rời trang bằng cách khác (trận bắt đầu, đăng xuất) thì tự lưu. Trong trận: Tạm dừng → "Chỉnh nút" (thay cho ô "Phím tắt"), hoặc nút tương tự trong Cài đặt của menu tạm dừng; trận vẫn chạy phía sau lớp mờ. Mọi nút hiện ra với viền nét đứt. Kéo nút để dời chỗ (luôn giữ trọn trong màn hình), chạm một nút rồi kéo thanh "Cỡ" để đổi cỡ riêng nút đó (60–200%, nhân thêm với cỡ chung trong cài đặt). Bảng chỉnh kéo được bằng phần tiêu đề nếu che nút. "Lưu" giữ lại, "Huỷ" bỏ thay đổi, "Mặc định" trả mọi nút về chỗ cũ. Mở menu khác giữa chừng trong trận (vuốt quay lại, bị hạ, hết trận) thì tự lưu. Mở trang Chỉnh nút trên điện thoại cầm dọc thì có thẻ nhắc xoay ngang (bố cục điện thoại dành cho lúc cầm ngang), kèm nút "Để sau".
  - Bố cục **lưu vào tài khoản** (cột `users.touch_layout`, API `GET`/`PUT /api/me/touch-layout`), riêng cho từng kiểu màn hình: điện thoại cầm ngang, màn hình ngang (máy tính bảng), màn hình dọc. Vị trí lưu theo tỉ lệ chiều rộng/chiều cao màn hình nên vẫn đúng khi kích thước đổi chút ít; nút chưa chỉnh vẫn theo vị trí mặc định trong `style.css`.
  - `src/ui/touchLayout.ts` giữ một bản sao trong trình duyệt (`localStorage` khoá `br2d_touch_layout`, ghi kèm id tài khoản) để trận vào ngay không chờ máy chủ, và vẫn chỉnh được khi mất mạng. Đăng nhập trên thiết bị cảm ứng thì tải bố cục của tài khoản về thay bản sao (bản sao của tài khoản khác không bao giờ được dùng). Bố cục chỉnh từ trước khi có tính năng này (chưa gắn tài khoản) được tự đẩy lên tài khoản nếu tài khoản chưa có. Bấm "Lưu" thì ghi bản sao ngay rồi gửi lên máy chủ; gửi lỗi thì báo, máy này vẫn dùng được.
- **Chạm nhiều ngón:** đang giữ cần di chuyển (hoặc cần ngắm) vẫn bấm được nút khác bằng ngón thứ hai: ô vũ khí, dải chọn chim trinh sát, bản đồ nhỏ, các ô trong túi đồ. Trình duyệt không gửi `click` cho ngón thứ hai nên các chỗ này nghe sự kiện con trỏ (`pointerdown`/`pointerup`, xem `onPress`/`onTap` trong `src/game/Hud.ts`) và đặt `touch-action: none` để trình duyệt không giành cú chạm.

## Âm thanh và nhạc

Mọi âm thanh được tổng hợp bằng WebAudio trong `src/game/audio.ts`, không có file âm thanh. Âm thanh trong trận có hướng (trái/phải) và nhỏ, đục dần theo khoảng cách.

- **Hiệu ứng** (gọi từ `GameScene.handleEvent` và vòng `update`):
  - Nạp tên: riêng từng vũ khí và trải đều theo thời gian nạp của vũ khí đó, tiếng cuối rơi đúng lúc nạp xong. Ống thổi là túi kim tre và tiếng gõ ống; cung là tiếng rút tên khỏi ống và lắp tên; nỏ là tiếng quay tay quay lách cách, chốt nặng rồi khoá; thần tiễn là tiếng kéo dây kẽo kẹt và tiếng ngân đồng.
  - Đổi vũ khí (`sfx.equip`): cầm dao nghe tiếng rút dao khỏi vỏ ngân kim loại, mỗi loại súng một tiếng riêng (tre, gỗ, dây cung, đồng). Server không gửi sự kiện đổi vũ khí, nên client so vũ khí của từng người giữa hai lần cập nhật; người vừa đi vào tầm nhìn đã cầm sẵn vũ khí khác thì không phát.
  - Vung dao "vút" sắc và có ánh kim; đấm tay không là tiếng gió đục hơn.
  - Ném hũ lửa hay bầu khói: tiếng lấy đà, vung tay, rồi tiếng vật xoay vù vù bay đi.
  - Bầu khói vỡ: tiếng nứt vỏ bầu rồi tiếng xì kéo dài khi khói tuôn ra. Server không gửi sự kiện riêng cho khói, nên tiếng phát khi một đám khói còn đang lan (bán kính dưới một nửa) xuất hiện lần đầu.
  - Hũ lửa nổ: tiếng vỡ sành, tiếng dầu bắt lửa "phừng" trầm, rồi tiếng lửa cháy ù ù và lách tách.
- **Nhạc nền** (bật/tắt bằng ô "Nhạc nền" trong Cài đặt): ở sảnh là bản hành khúc hào hùng thời Hùng Vương (Rê thứ, có tiếng hô). Vào trận (`setMatchMusic` trong `session.ts`) thì chuyển sang bài riêng của bản đồ, khác hẳn nhạc sảnh: không có tiếng hô, khoảng lặng nhiều hơn, thêm một lớp đàn dây trầm ngân dài thở ra thở vào, có các nốt nghịch (quãng 6 thứ, quãng 2 thứ) tạo cảm giác bất an. Mỗi bài 16 ô nhịp, cuối bài có hồi trống dẫn về đầu.

  Nhạc trận đổi theo diễn biến (`updateMusicTension` trong `session.ts`, gọi `setMusicTension`; đổi ở đầu ô nhịp kế tiếp):

  | Mức | Khi nào | Nghe thế nào |
  | --- | --- | --- |
  | 0 · dò đường | mặc định, đang ở khu chờ, trận đã kết thúc | tiết tấu thưa, giai điệu nhỏ hơn, lớp đàn dây chỉ có quãng 6 thứ rất khẽ |
  | 1 · giao tranh | 6–10 giây sau khi trúng đòn, gây sát thương, có tiếng bắn hoặc nổ trong khoảng 650–700 px quanh tầm nhìn; vòng bo đang thu; hai vòng bo cuối; còn ít hơn 40% người chơi | tiết tấu dồn, tiếng tích tắc như đồng hồ, tiếng gió cuộn lên mỗi 4 ô nhịp, nhạc to và sáng hơn |
  | 2 · sinh tử | còn rất ít người (tối đa 3, hoặc 25%), hoặc đang giao tranh khi máu ≤ 35 hay ở hai vòng bo cuối | nhịp tim thình thịch, tích tắc dày gấp đôi, bè trầm lắc giữa nốt gốc và quãng 2 thứ, đàn tranh rung ở nốt cao, lớp đàn dây nghịch hẳn; lúc bước vào có một tiếng cồng và trống đồng nặng |

  Ở Trường Tập Bắn, tự mình bắn hay bắn trúng lợn không tính là giao tranh, để nhạc không dồn dập khi đang tập.

  | Bản đồ | Nhịp độ | Điệu thức | Đặc trưng |
  | --- | --- | --- | --- |
  | Nước Văn Lang | 104 | Đô thứ | chiến tranh đang nhen: tù và trầm bám quãng 2 thứ, trống phi ngựa 3-3-2, sáo dừng lửng trên hợp âm át ở cuối mỗi nửa bài |
  | Thành Cổ Loa | 124 | Mi thứ ngũ cung | căng và nhanh, đàn tranh gõ đều như lẫy nỏ, mõ, tù và dồn |
  | Núi Nghĩa Lĩnh | 80 | La thứ ngũ cung | chậm và huyền bí: đàn bầu, cồng chiêng mỗi 4 ô nhịp, đàn đá, trống trầm |
  | Làng Lạc Việt | 112 | Son trưởng ngũ cung | hội làng: sáo múa, đàn tranh, mõ, sênh tiền, trống tay |
  | Kinh Đô Phong Châu | 92 | Fa trưởng ngũ cung | nghi lễ cung đình: kèn hiệu, đàn đá, trống đồng, cồng chiêng |
  | Trường Tập Bắn | 100 | Đô trưởng ngũ cung | nhẹ và đều để tập trung ngắm: đàn tranh, rồi sáo |

  Mỗi bài được khai báo bằng dữ liệu trong `THEMES`: tiết tấu ghi mỗi ký tự là một nốt móc kép, giai điệu ghi dạng `nốt:độ dài` với `|` ngăn các ô nhịp. Các bè dựa trên nốt gốc của từng ô nhịp; nốt nghịch chỉ được thêm có chủ đích để tạo độ hồi hộp.
