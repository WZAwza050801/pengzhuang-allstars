// Original geometric assets. This exporter never samples source artwork or paints text.
function renderUiPack({ page, sprites, tokens }) {
  const canvas = document.createElement('canvas');
  canvas.width = page.width;
  canvas.height = page.height;
  const out = canvas.getContext('2d');
  for (const sprite of sprites) {
    const tile = document.createElement('canvas');
    tile.width = sprite.width;
    tile.height = sprite.height;
    const c = tile.getContext('2d');
    const [kind, theme, name, state] = sprite.id.split('.');
    const palette = tokens.themes[theme];
    if (kind === 'surface') {
      c.fillStyle = state === 'disabled' ? palette.disabled : name === 'primary' ? palette.accent : palette.panel;
      c.beginPath();
      c.roundRect(2, 2, 60, 60, tokens.radius);
      c.fill();
      c.strokeStyle = state === 'selected' ? palette.focus : palette.border;
      c.lineWidth = state === 'selected' ? 4 : 2;
      c.stroke();
      if (state === 'selected') {
        c.fillStyle = palette.focus;
        c.fillRect(20, 55, 24, 4);
      }
    } else if (kind === 'icon') {
      c.strokeStyle = palette.ink;
      c.fillStyle = palette.ink;
      c.lineWidth = 3;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      const line = (points, close = false) => {
        c.beginPath();
        points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
        if (close) c.closePath();
        c.stroke();
      };
      const circle = (x, y, r) => {
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.stroke();
      };
      if (name === 'back') {
        line([
          [25, 10],
          [11, 24],
          [25, 38],
        ]);
        line([
          [12, 24],
          [38, 24],
        ]);
      }
      if (name === 'close') {
        line([
          [13, 13],
          [35, 35],
        ]);
        line([
          [35, 13],
          [13, 35],
        ]);
      }
      if (name === 'check')
        line([
          [10, 25],
          [20, 35],
          [38, 13],
        ]);
      if (name === 'settings') {
        circle(24, 24, 12);
        circle(24, 24, 4);
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          line([
            [24 + Math.cos(a) * 14, 24 + Math.sin(a) * 14],
            [24 + Math.cos(a) * 19, 24 + Math.sin(a) * 19],
          ]);
        }
      }
      if (name === 'ball') {
        circle(24, 24, 17);
        line(
          [
            [24, 15],
            [33, 22],
            [29, 32],
            [19, 32],
            [15, 22],
          ],
          true,
        );
        line([
          [24, 7],
          [24, 15],
        ]);
        line([
          [7, 23],
          [15, 22],
        ]);
        line([
          [41, 23],
          [33, 22],
        ]);
        line([
          [16, 39],
          [19, 32],
        ]);
        line([
          [32, 39],
          [29, 32],
        ]);
      }
      if (name === 'lineup') {
        for (const [x, y] of [
          [24, 11],
          [12, 25],
          [36, 25],
          [24, 38],
        ])
          circle(x, y, 5);
      }
      if (name === 'mail') {
        line(
          [
            [7, 12],
            [41, 12],
            [41, 36],
            [7, 36],
          ],
          true,
        );
        line([
          [8, 13],
          [24, 27],
          [40, 13],
        ]);
      }
      if (name === 'trophy') {
        line(
          [
            [14, 9],
            [34, 9],
            [32, 25],
            [24, 31],
            [16, 25],
          ],
          true,
        );
        line([
          [14, 13],
          [7, 13],
          [8, 23],
          [16, 25],
        ]);
        line([
          [34, 13],
          [41, 13],
          [40, 23],
          [32, 25],
        ]);
        line([
          [24, 31],
          [24, 39],
        ]);
        line([
          [16, 39],
          [32, 39],
        ]);
      }
    } else {
      const p = tokens.stadium,
        tier = Number(theme.slice(-1));
      const xy = (x, y, z = 0) => [128 + (x - 0.5) * 168 + (y - 0.5) * 64, 112 + (x - 0.5) * 24 - (y - 0.5) * 104 - z];
      const shape = (points, color) => {
        c.fillStyle = color;
        c.beginPath();
        points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
        c.closePath();
        c.fill();
      };
      shape([xy(-0.09, -0.09), xy(1.09, -0.09), xy(1.09, 1.09), xy(-0.09, 1.09)], p.standSide);
      for (let i = 0; i < 8; i++)
        shape(
          [xy(i / 8, 0, 4), xy((i + 1) / 8, 0, 4), xy((i + 1) / 8, 1, 4), xy(i / 8, 1, 4)],
          i % 2 ? p.grass : p.stripe,
        );
      c.strokeStyle = p.line;
      c.lineWidth = 1.5;
      const line = (points) => {
        c.beginPath();
        points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
        c.stroke();
      };
      line([xy(0.025, 0.025, 5), xy(0.975, 0.025, 5), xy(0.975, 0.975, 5), xy(0.025, 0.975, 5), xy(0.025, 0.025, 5)]);
      line([xy(0, 0.5, 5), xy(1, 0.5, 5)]);
      line([xy(0.3, 0, 5), xy(0.3, 0.18, 5), xy(0.7, 0.18, 5), xy(0.7, 0, 5)]);
      line([xy(0.3, 1, 5), xy(0.3, 0.82, 5), xy(0.7, 0.82, 5), xy(0.7, 1, 5)]);
      line(
        Array.from({ length: 33 }, (_, i) =>
          xy(0.5 + Math.cos((i * Math.PI) / 16) * 0.13, 0.5 + Math.sin((i * Math.PI) / 16) * 0.13, 5),
        ),
      );
      for (const side of [0, 1]) {
        const y = side === 0 ? -0.12 : 1.04,
          high = 12 + tier * 3;
        shape([xy(0.08, y, 0), xy(0.92, y, 0), xy(0.92, y, high), xy(0.08, y, high)], p.standSide);
        shape([xy(0.08, y, high), xy(0.92, y, high), xy(0.92, y + 0.08, high), xy(0.08, y + 0.08, high)], p.stand);
        for (let row = 0; row < tier; row++) line([xy(0.12, y, 5 + row * 3), xy(0.88, y, 5 + row * 3)]);
      }
      c.fillStyle = p.ball;
      c.beginPath();
      const [bx, by] = xy(0.5, 0.5, 8);
      c.arc(bx, by, 3, 0, Math.PI * 2);
      c.fill();
    }
    const { x, y, width: w, height: h } = sprite;
    out.drawImage(tile, x, y);
    // Extrude two pixels, including corners, so scaled sampling never reads a neighbour.
    for (let offset = 1; offset <= 2; offset++) {
      out.drawImage(tile, 0, 0, 1, h, x - offset, y, 1, h);
      out.drawImage(tile, w - 1, 0, 1, h, x + w - 1 + offset, y, 1, h);
      out.drawImage(tile, 0, 0, w, 1, x, y - offset, w, 1);
      out.drawImage(tile, 0, h - 1, w, 1, x, y + h - 1 + offset, w, 1);
    }
    for (const [sx, sy, dx, dy] of [
      [0, 0, x - 2, y - 2],
      [w - 1, 0, x + w, y - 2],
      [0, h - 1, x - 2, y + h],
      [w - 1, h - 1, x + w, y + h],
    ])
      out.drawImage(tile, sx, sy, 1, 1, dx, dy, 2, 2);
  }
  return canvas.toDataURL('image/png');
}
globalThis.renderUiPack = renderUiPack;
