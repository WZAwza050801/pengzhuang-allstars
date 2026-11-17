// Original geometric placeholders. No recovered portraits, logos, fonts or external images are sampled.
globalThis.renderCardAtlas = ({ page, portraits, frames }) => {
  const canvas = document.createElement('canvas');
  canvas.width = page.width;
  canvas.height = page.height;
  const target = canvas.getContext('2d');
  const colors = { white: '#a8b3bd', green: '#2f9a1e', blue: '#1f74c8', purple: '#9b2fc0', orange: '#c55a00' };
  const portrait = (ctx, area) => {
    const seed = Number(area.playerId.slice(1));
    const jersey = { FW: '#166b98', MF: '#187a61', DF: '#ad4c37', GK: '#925d18' }[area.position];
    ctx.save();
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#dce9ea';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#b7d1d2';
    ctx.beginPath();
    ctx.arc(20 + (seed % 60), 100, 78, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = jersey;
    ctx.beginPath();
    ctx.moveTo(17, 128);
    ctx.lineTo(24, 86);
    ctx.quadraticCurveTo(64, 66, 104, 86);
    ctx.lineTo(111, 128);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f6f5e9';
    ctx.beginPath();
    ctx.moveTo(49, 79);
    ctx.lineTo(64, 94);
    ctx.lineTo(79, 79);
    ctx.lineTo(73, 75);
    ctx.lineTo(64, 84);
    ctx.lineTo(55, 75);
    ctx.fill();
    ctx.fillStyle = ['#f1c899', '#bd865a', '#dfaa7d', '#905b3d'][seed % 4];
    ctx.beginPath();
    ctx.arc(64, 47, 25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ['#333739', '#6b442f', '#362820', '#a47b43'][Math.floor(seed / 4) % 4];
    ctx.beginPath();
    ctx.moveTo(39, 49);
    ctx.lineTo(38, 34);
    ctx.quadraticCurveTo(47, 10, 74, 22);
    ctx.lineTo(88, 31);
    ctx.lineTo(89, 48);
    ctx.lineTo(79, 36 + (seed % 6));
    ctx.lineTo(56, 37);
    ctx.lineTo(48, 44);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#26313a';
    ctx.beginPath();
    ctx.arc(54, 49, 2.3, 0, Math.PI * 2);
    ctx.arc(74, 49, 2.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#6e4431';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(64, 56, 7, 0.2, Math.PI - 0.2);
    ctx.stroke();
    // Distinct geometric jersey marks are derived from the stable ID; labels remain dynamic text.
    for (let bit = 0; bit < 7; bit++) {
      ctx.fillStyle = seed & (1 << bit) ? '#f7f2d5' : '#183747';
      ctx.fillRect(35 + bit * 8, 106, 5, 8);
    }
    ctx.restore();
    ctx.strokeStyle = colors[area.quality];
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.stroke();
  };
  const frame = (ctx, area) => {
    const disabled = area.state === 'disabled';
    ctx.fillStyle = disabled ? '#d0d5d5' : '#eef2ef';
    ctx.beginPath();
    ctx.roundRect(2, 2, 156, 220, 12);
    ctx.fill();
    ctx.strokeStyle = disabled ? '#687a84' : colors[area.quality];
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = disabled ? '#8d999f' : colors[area.quality];
    ctx.fillRect(12, 141, 136, 5);
    ctx.fillStyle = '#dae3e2';
    ctx.beginPath();
    ctx.roundRect(10, 183, 140, 29, 5);
    ctx.fill();
    if (area.state === 'selected') {
      ctx.strokeStyle = '#efb731';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(6, 6, 148, 212, 8);
      ctx.stroke();
      ctx.fillStyle = '#173c53';
      ctx.beginPath();
      ctx.arc(139, 199, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffe082';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(133, 199);
      ctx.lineTo(137, 203);
      ctx.lineTo(145, 194);
      ctx.stroke();
    }
    if (disabled) {
      ctx.fillStyle = '#38515f';
      ctx.fillRect(132, 197, 14, 11);
      ctx.strokeStyle = '#38515f';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(139, 196, 5, Math.PI, 0);
      ctx.stroke();
    }
  };
  for (const area of [...portraits, ...frames]) {
    const tile = document.createElement('canvas');
    tile.width = area.width;
    tile.height = area.height;
    const ctx = tile.getContext('2d');
    if (area.playerId) portrait(ctx, area);
    else frame(ctx, area);
    const { x, y, width: w, height: h } = area;
    target.drawImage(tile, x, y);
    target.drawImage(tile, 0, 0, w, 1, x, y - 2, w, 2);
    target.drawImage(tile, 0, h - 1, w, 1, x, y + h, w, 2);
    target.drawImage(tile, 0, 0, 1, h, x - 2, y, 2, h);
    target.drawImage(tile, w - 1, 0, 1, h, x + w, y, 2, h);
    for (const [sx, dx] of [
      [0, x - 2],
      [w - 1, x + w],
    ])
      for (const [sy, dy] of [
        [0, y - 2],
        [h - 1, y + h],
      ])
        target.drawImage(tile, sx, sy, 1, 1, dx, dy, 2, 2);
  }
  return canvas.toDataURL('image/png');
};
