import {
  AMMO_NAMES,
  ARMOR,
  BAG_CAPACITY,
  DEFAULT_MAP,
  ITEMS,
  ITEM_IDS,
  MAP_DEFS,
  MAX_HP,
  MAX_PLAYERS,
  MEDKIT,
  THROWABLE,
  TRAINING_LANES,
  WEAPONS,
  ZONE_PHASES,
  type WeaponId,
} from '../shared';
import { saveSettings, settings, useTouchControls, type Settings } from '../settings';
import { STORY_TITLE, storyHtml } from './story';
import { esc, formatDuration } from './dom';
import { RARITY_NAME, iconSvg, rarityCss, rarityOf, type IconId } from '../game/icons';

export const KEYBINDS: [string, string][] = [
  ['W A S D / Phím mũi tên', 'Di chuyển'],
  ['Chuột', 'Ngắm (nhân vật quay theo chuột)'],
  ['Chuột trái', 'Bắn / đánh / ném hũ lửa'],
  ['Chuột phải', 'Nhặt món đồ đang trỏ chuột, không trỏ thì nhặt món gần nhất trong tầm'],
  ['R', 'Nạp tên'],
  ['F', 'Nhặt đồ, mở / đóng cửa, mở thính'],
  ['1 / 2', 'Vũ khí chính 1 / vũ khí chính 2'],
  ['E', 'Ống thổi'],
  ['V', 'Dao / tay không'],
  ['3', 'Hũ lửa'],
  ['4', 'Bầu khói'],
  ['Q / 5', 'Đắp thuốc nam'],
  ['Z', 'Đổi chim trinh sát'],
  ['Lăn chuột', 'Đổi vũ khí'],
  ['Chuột giữa', 'Cắm cờ đánh dấu chỗ đang trỏ chuột, bấm lại vào cờ để gỡ'],
  ['Tab', 'Mở túi đồ'],
  ['M', 'Mở bản đồ lớn (bấm lên bản đồ để cắm cờ đánh dấu)'],
  ['Esc', 'Tạm dừng / cài đặt'],
];

export function keysPanel(): string {
  return `
    <table class="list">
      <thead><tr><th>Phím</th><th>Chức năng</th></tr></thead>
      <tbody>${KEYBINDS.map(([k, v]) => `<tr><td>${k.split(' / ').map((p) => `<span class="kbd">${esc(p)}</span>`).join(' / ')}</td><td>${esc(v)}</td></tr>`).join('')}</tbody>
    </table>
    <h3>Trên điện thoại</h3>
    <ul class="muted">
      <li>Chạm và kéo nửa trái màn hình để di chuyển.</li>
      <li>Chạm và kéo nửa phải màn hình để xoay người (chỉ xoay, không bắn).</li>
      <li>Giữ nút bắn (vòng ngắm viền đỏ, mặc định ở nửa trái phía trên cần di chuyển) để bắn.</li>
      <li>Khi cầm hũ lửa hoặc bầu khói: giữ nút bắn rồi thả tay để ném. Đang kéo cần xoay lúc thả thì kéo càng xa ném càng xa, không kéo thì ném tầm vừa.</li>
      <li>Chạm vào ô vũ khí ở dưới để đổi vũ khí. Các nút bên phải: Nhặt, Nạp tên, Thuốc nam, Hũ lửa, Bầu khói.</li>
      <li>Mở bản đồ lớn rồi chạm lên bản đồ để cắm cờ đánh dấu, chạm lại vào cờ để gỡ.</li>
    </ul>`;
}

export function guidePanel(): string {
  const zoneRows = ZONE_PHASES.map(
    (p, i) => `<tr><td>${i + 1}</td><td>${formatDuration(p.waitMs)}</td><td>${formatDuration(p.shrinkMs)}</td><td>${p.damagePerSecond}/giây</td></tr>`,
  ).join('');
  return `
  <div class="guide">
    <h3>Cốt truyện: ${STORY_TITLE}</h3>
    <div class="guide-story">${storyHtml()}</div>
    <h3>Mục tiêu</h3>
    <p>Trận đấu có tối đa ${MAX_PLAYERS} người. Bạn xuất hiện ngẫu nhiên trên bản đồ với hai bàn tay trắng. Hãy nhặt vũ khí, trang bị và là người <b>sống sót cuối cùng</b>.</p>
    <h3>Bản đồ</h3>
    <p>Có 5 bản đồ. <b>${MAP_DEFS[DEFAULT_MAP].name}</b> là bản đồ lớn cho ${MAP_DEFS[DEFAULT_MAP].maxPlayers} người, gồm kinh thành ở giữa và các vùng Cổ Loa, Nghĩa Lĩnh, Lạc Việt ở bốn góc. Bốn bản đồ còn lại nhỏ hơn, tối đa ${MAP_DEFS.coloa.maxPlayers} người: <b>Thành Cổ Loa</b>, <b>Núi Nghĩa Lĩnh</b>, <b>Làng Lạc Việt</b> và <b>Kinh Đô Phong Châu</b>. Cây cối, đá, nhà cửa và tường thành luôn cố định nên bạn có thể thuộc đường; vật phẩm thì mỗi trận rải ngẫu nhiên. Đấu với bot thì bạn tự chọn bản đồ và bot lấp đầy số chỗ của bản đồ đó (độ khó Dễ, Vừa, Khó chỉ đổi tốc độ chạy của bot), phòng bạn bè do chủ phòng đặt tên và chọn bản đồ, kiểu đội (Đơn, Nhóm 2, Nhóm 4; mỗi người tự bấm vào ô trống của đội mình muốn). Phòng công khai hiện ở cột <b>Phòng đang mở</b> bên trái sảnh, bấm vào là vào phòng; phòng kín chỉ vào được bằng mã hoặc link mời. Ghép trận luôn diễn ra trên ${MAP_DEFS[DEFAULT_MAP].name}. Tên khu vực bạn đang đứng hiện dưới bản đồ nhỏ, bản đồ lớn (<span class="kbd">M</span>) ghi tên mọi khu vực.</p>
    <h3>Cắm cờ đánh dấu</h3>
    <p>Mỗi người cắm được một lá cờ để đánh dấu nơi muốn tới: bấm lên bản đồ lớn (<span class="kbd">M</span>) hoặc bấm <span class="kbd">Chuột giữa</span> vào chỗ đang trỏ trong trận. Cắm chỗ khác thì cờ cũ được dời sang, bấm lại vào cờ (hoặc nút "Gỡ cờ" trên bản đồ lớn) để gỡ. Đấu đơn thì chỉ mình bạn thấy cờ; đấu nhóm thì cả đội cùng thấy, mỗi người một màu và có thông báo khi đồng đội cắm cờ. Trên bản đồ nhỏ, một đường nét đứt nối từ người cắm tới lá cờ để biết hướng đi.</p>
    <h3>Ghép trận đơn và theo nhóm</h3>
    <p>Ở thẻ ghép trận, chọn <b>Đơn</b> để vào hàng chờ ngay, mỗi người một đội. Chọn <b>Nhóm 2</b> hoặc <b>Nhóm 4</b> để lập nhóm: mời bạn bè đang trực tuyến hoặc gửi link mời, rồi trưởng nhóm bấm tìm trận. Bật "Ghép thêm người lạ" thì chỗ trống được ghép với người chơi ngẫu nhiên, tắt thì nhóm vào trận với đúng số người đang có. Đồng đội không bắn trúng nhau (hũ lửa của chính bạn vẫn gây sát thương cho bạn), luôn thấy nhau trên bản đồ nhỏ, và được xếp hạng chung: đội còn người sống cuối cùng thắng. Bị loại khi đồng đội còn sống thì bạn chỉ xem được đồng đội.</p>
    <h3>Phòng chờ đầu trận</h3>
    <p>Ghép trận và phòng bạn bè đều mở đầu bằng <b>30 giây phòng chờ</b> ở giữa bản đồ để mọi người kịp vào và tải xong bản đồ. Trong phòng chờ chỉ có nhà cửa, chưa có vật phẩm, không ai gây được sát thương, và bạn không ra khỏi được vòng tròn vàng. Hết giờ, mọi người được đưa tới điểm xuất phát (đồng đội đứng cạnh nhau) và trận đấu bắt đầu.</p>
    <h3>Trường tập bắn</h3>
    <p>Chế độ một người để luyện ngắm. Cung, tên, hũ lửa và đủ các loài chim trinh sát được cấp sẵn và không bao giờ hết, giá vũ khí sau vạch bắn có thêm nỏ và dao. Lợn rừng chạy qua lại ở các làn cách vạch bắn ${TRAINING_LANES.map((l) => l.distance).join(', ')}. Làn xa cần chim trinh sát lớn mới nhìn thấy, và lợn chạy nhanh nên phải bắn đón. Góc trên màn hình ghi số viên trúng, tỉ lệ trúng, số con đã hạ và cú trúng xa nhất. Ở đây bạn không mất máu, kết quả không tính XP và không lưu vào lịch sử.</p>
    <h3>Nhặt đồ và túi đồ</h3>
    <ul>
      <li>Vật phẩm trong tầm nhặt có nền sáng nhấp nháy. Bấm <span class="kbd">F</span> hoặc <span class="kbd">Chuột phải</span> để nhặt; chuột phải nhặt đúng món bạn đang trỏ, không trỏ món nào thì nhặt món gần nhất. Chuột trái luôn là tấn công. Bật "Tự động nhặt" trong Cài đặt thì tên, thuốc nam, hũ lửa, bầu khói và chim trinh sát sẽ tự nhặt khi bạn đi qua; mặc định tắt. Thuần phục được chim tinh mắt hơn con đang dùng thì tự đổi sang luôn, chim kém hơn chỉ theo bạn để dành (đổi bằng <span class="kbd">Z</span>).</li>
      <li>Mang tối đa <b>2 vũ khí chính</b> (cung tên, nỏ, thần tiễn) cộng thêm <b>1 ống thổi</b> và <b>1 vũ khí cận chiến</b>.</li>
      <li>Mỗi loại vũ khí dùng một loại tên riêng: ống thổi dùng kim tre, cung tên dùng mũi tên, nỏ dùng tên nỏ, thần tiễn dùng tên móng rùa. Gùi càng lớn thì mang được càng nhiều tên và vật phẩm.</li>
      <li>Bấm <span class="kbd">Tab</span> để xem túi đồ và vứt bớt đồ.</li>
    </ul>
    <h3>Nhà cửa</h3>
    <p>Bấm <span class="kbd">F</span> gần cửa để mở hoặc đóng. Khi bạn vào một phòng, mái của phòng đó sẽ ẩn đi để bạn thấy bên trong. Người ở ngoài <b>không nhìn thấy</b> người trong phòng, và người ở các phòng khác nhau cũng không thấy nhau.</p>
    <h3>Rương đồ và thính</h3>
    <ul>
      <li><b>Rương đồ</b>: đấm, chém hoặc bắn cho vỡ để lấy hũ lửa, giáp da, chim cắt, gùi lớn, thuốc nam hoặc cung tên.</li>
      <li><b>Thính</b>: cứ 3 phút rơi một lần, luôn rơi bên trong vòng bo tiếp theo và được báo trên bản đồ. Bên trong có thần tiễn, tên móng rùa, giáp đồng và đại bàng hoặc chim Lạc.</li>
    </ul>
    <h3>Chim trinh sát</h3>
    <p>Chim thuần phục được sẽ mở rộng tầm nhìn từ trên xuống, mặc định là mắt thường x1: chim sẻ x2, chim sáo x3, chim cắt x4, đại bàng x6 và chim Lạc x8. Thuần phục chim mới sẽ tự đổi sang con đó; mỗi loài chỉ giữ một con. Bấm vào ô chim dưới bản đồ nhỏ, trong túi đồ, hoặc bấm <span class="kbd">Z</span> để đổi giữa các con bạn có.</p>
    <h3>Vòng bo</h3>
    <p>Vòng bo thu nhỏ qua ${ZONE_PHASES.length} giai đoạn, trận đấu kéo dài khoảng 14–15 phút. Đứng ngoài bo sẽ mất máu liên tục (giáp không giảm sát thương bo). Vòng tròn trắng là vùng an toàn tiếp theo.</p>
    <div class="table-wrap"><table class="list"><thead><tr><th>Giai đoạn</th><th>Chờ</th><th>Thu nhỏ</th><th>Sát thương ngoài bo</th></tr></thead><tbody>${zoneRows}</tbody></table></div>
    <h3>Bầu khói và hũ lửa</h3>
    <p>Hũ lửa được châm ngòi ngay khi bạn cầm lên và nổ sau ${THROWABLE.grenade.fuseMs / 1000} giây tính từ lúc đó, dù đã ném hay chưa. Ném sớm thì đối thủ có thời gian chạy, giữ lâu rồi mới ném thì nổ nhanh hơn, nhưng giữ quá lâu sẽ nổ ngay trên tay. Đổi sang vũ khí khác là cất hũ lửa và dập ngòi. Bầu khói tạo màn khói che tầm nhìn của tất cả mọi người, kể cả bot, trong ${THROWABLE.smoke.durationMs / 1000} giây.</p>
    <h3>Khi bị hạ gục</h3>
    <p>Bạn có thể xem tiếp người đã hạ mình, xem người chơi khác hoặc về sảnh. Nếu mất mạng giữa trận, nhân vật sẽ đứng yên cho đến khi bạn vào lại.</p>
    <h3>Máu</h3>
    <p>Máu tối đa là ${MAX_HP}. Đắp thuốc nam hồi ${MEDKIT.heal} máu sau ${MEDKIT.useMs / 1000} giây.</p>
  </div>`;
}

function weaponStats(id: WeaponId): string {
  const w = WEAPONS[id];
  if (w.slot === 'melee') return `Sát thương ${w.damage} · ${w.fireRate} đòn/giây · tầm ${w.range}`;
  const dmg = w.pellets > 1 ? `${w.pellets}×${w.damage}` : `${w.damage}`;
  return `Sát thương ${dmg} · ${w.fireRate} phát/giây · mỗi lượt nạp ${w.magSize} · nạp lại ${w.reloadMs / 1000}s · tầm ${w.range} · độ tản ${w.spread}° · ${AMMO_NAMES[w.ammo!]}`;
}

function itemIconBox(id: IconId): string {
  return `<div class="ic" style="--rarity:${rarityCss(id)}">${iconSvg(id, 44)}</div>`;
}

function rarityTag(id: IconId): string {
  return `<span class="rarity" style="--rarity:${rarityCss(id)}">${RARITY_NAME[rarityOf(id)]}</span>`;
}

export function itemsPanel(): string {
  const weapons = (['fists', 'knife', 'pistol', 'rifle', 'shotgun', 'sniper'] as WeaponId[])
    .map((id) => {
      const w = WEAPONS[id];
      return `<div class="item-row">${itemIconBox(id)}<div><h4>${esc(w.name)} ${rarityTag(id)}</h4><p>${esc(w.desc)}</p><div class="statline">${esc(weaponStats(id))}</div></div></div>`;
    })
    .join('');
  const others = ITEM_IDS.filter((id) => ITEMS[id].kind !== 'weapon')
    .map((id) => {
      const it = ITEMS[id];
      return `<div class="item-row">${itemIconBox(id)}<div><h4>${esc(it.name)} ${rarityTag(id)}</h4><p>${esc(it.desc)}</p><div class="statline">Nơi tìm thấy: ${esc(it.source)}</div></div></div>`;
    })
    .join('');
  const bagRows = ([0, 1, 2, 3] as const)
    .map((l) => {
      const c = BAG_CAPACITY[l];
      return `<tr><td>${l === 0 ? 'Tay không' : ITEMS[`bag${l}`].name}</td><td>${c.ammo['9mm']}</td><td>${c.ammo['556']}</td><td>${c.ammo['12g']}</td><td>${c.ammo['762']}</td><td>${c.medkit}</td><td>${c.grenade}</td><td>${c.smoke}</td></tr>`;
    })
    .join('');
  const armorRows = ([1, 2, 3] as const)
    .map((l) => `<tr><td>${ITEMS[`armor${l}`].name} (cấp ${l})</td><td>${ARMOR[l].reduction * 100}%</td><td>${ARMOR[l].durability}</td></tr>`)
    .join('');
  return `
    <h3>Vũ khí</h3><div class="grid">${weapons}</div>
    <h3>Vật phẩm</h3><div class="grid">${others}</div>
    <h3>Sức chứa của gùi</h3>
    <div class="table-wrap"><table class="list"><thead><tr><th>Gùi</th><th>Kim tre</th><th>Mũi tên</th><th>Tên nỏ</th><th>Móng rùa</th><th>Thuốc nam</th><th>Hũ lửa</th><th>Bầu khói</th></tr></thead><tbody>${bagRows}</tbody></table></div>
    <h3>Giáp</h3>
    <div class="table-wrap"><table class="list"><thead><tr><th>Giáp</th><th>Giảm sát thương</th><th>Độ bền</th></tr></thead><tbody>${armorRows}</tbody></table></div>
    <p class="muted">Độ bền giáp giảm đúng bằng lượng sát thương nó chặn được. Khi độ bền về 0, giáp bị vỡ.</p>`;
}

/** `canEditLayout`: offer the button editor (touch screens only, where the caller can open it). */
export function settingsPanel(canEditLayout = false): string {
  const s = settings;
  return `
    <div class="field"><label>Âm lượng: <b id="vol-label">${Math.round(s.volume * 100)}%</b></label>
      <div class="slider-row"><input type="range" min="0" max="100" value="${Math.round(s.volume * 100)}" data-setting="volume" /></div></div>
    <div class="field"><label><input type="checkbox" data-setting="sfx" ${s.sfx ? 'checked' : ''}/> Bật hiệu ứng âm thanh</label></div>
    <div class="field"><label><input type="checkbox" data-setting="ambient" ${s.ambient ? 'checked' : ''}/> Âm thanh môi trường (gió, sóng, chim hót)</label></div>
    <div class="field"><label><input type="checkbox" data-setting="music" ${s.music ? 'checked' : ''}/> Nhạc nền (trống đồng, sáo trúc, cồng chiêng; mỗi bản đồ một bài riêng)</label></div>
    <div class="field"><label><input type="checkbox" data-setting="autoPickup" ${s.autoPickup ? 'checked' : ''}/> Tự động nhặt (tên, thuốc nam, hũ lửa, bầu khói, chim khi đi qua)</label></div>
    <div class="field"><label><input type="checkbox" data-setting="damageNumbers" ${s.damageNumbers ? 'checked' : ''}/> Hiện số sát thương</label></div>
    <div class="field"><label><input type="checkbox" data-setting="screenShake" ${s.screenShake ? 'checked' : ''}/> Rung màn hình</label></div>
    <div class="field"><label><input type="checkbox" data-setting="showFps" ${s.showFps ? 'checked' : ''}/> Hiện FPS và ping</label></div>
    ${useTouchControls() ? `<div class="field"><label>Kích thước nút cảm ứng: <b id="touch-label">${Math.round(s.touchSize * 100)}%</b></label>
      <div class="slider-row"><input type="range" min="50" max="140" value="${Math.round(s.touchSize * 100)}" data-setting="touchSize" /></div>
      ${canEditLayout ? '<button type="button" class="btn small" data-edit-layout>🎛️ Chỉnh vị trí và cỡ từng nút</button><p class="muted">Bố cục được lưu vào tài khoản, lần sau đăng nhập không phải chỉnh lại.</p>' : ''}</div>` : ''}`;
}

export function bindSettings(root: HTMLElement, editLayout?: () => void) {
  if (editLayout) root.querySelector('[data-edit-layout]')?.addEventListener('click', editLayout);
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]').forEach((el) => {
    const key = el.dataset.setting as keyof Settings;
    el.addEventListener('input', () => {
      let value: unknown;
      if (el instanceof HTMLInputElement && el.type === 'checkbox') value = el.checked;
      else if (el instanceof HTMLInputElement && el.type === 'range') value = Number(el.value) / 100;
      else value = el.value;
      saveSettings({ [key]: value } as Partial<Settings>);
      if (key === 'volume') root.querySelector('#vol-label')!.textContent = `${el.value}%`;
      if (key === 'touchSize') root.querySelector('#touch-label')!.textContent = `${el.value}%`;
    });
  });
}
