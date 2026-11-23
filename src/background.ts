export type AudioInput = Readonly<{ low: number; mid: number; high: number; energy: number }>;
type Point = readonly [number, number];
type Cubic = readonly [number, number, number, number, number, number];
type Curve = readonly [Point, Cubic, Cubic];
type ColorStop = readonly [number, string];

const SILENT: AudioInput = Object.freeze({ low: 0, mid: 0, high: 0, energy: 0 });

function gradient(
  context: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stops: readonly ColorStop[],
) {
  const fill = context.createLinearGradient(x0, y0, x1, y1);
  for (const [position, color] of stops) fill.addColorStop(position, color);
  return fill;
}

function glow(context: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
  const fill = context.createRadialGradient(x, y, 0, x, y, radius);
  fill.addColorStop(0, color);
  fill.addColorStop(1, 'transparent');
  context.fillStyle = fill;
  context.fillRect(0, 0, 1, 1);
}

function trace(context: CanvasRenderingContext2D, curve: Curve, offset: number, reversed = false) {
  const [start, first, second] = curve;
  const [firstX1, firstY1, firstX2, firstY2, middleX, middleY] = first;
  const [secondX1, secondY1, secondX2, secondY2, endX, endY] = second;
  let cubics: readonly Cubic[] = [first, second];

  if (reversed) {
    context.lineTo(endX, endY + offset);
    cubics = [
      [secondX2, secondY2, secondX1, secondY1, middleX, middleY],
      [firstX2, firstY2, firstX1, firstY1, start[0], start[1]],
    ];
  } else {
    context.moveTo(start[0], start[1] + offset);
  }

  for (const [x1, y1, x2, y2, x3, y3] of cubics) {
    context.bezierCurveTo(x1, y1 + offset, x2, y2 + offset, x3, y3 + offset);
  }
}

function sheetPath(context: CanvasRenderingContext2D, curve: Curve, offset: number) {
  context.beginPath();
  trace(context, curve, offset);
  context.lineTo(curve[2][4], 1.3);
  context.lineTo(curve[0][0], 1.3);
  context.closePath();
}

function sheet(context: CanvasRenderingContext2D, curve: Curve, offset: number, fill: CanvasGradient) {
  sheetPath(context, curve, offset);
  context.fillStyle = fill;
  context.fill();
}

function lightSheet(context: CanvasRenderingContext2D, curve: Curve, offset: number, x: number, y: number, radius: number, color: string) {
  context.save();
  sheetPath(context, curve, offset);
  context.clip();
  glow(context, x, y, radius, color);
  context.restore();
}

function ribbon(context: CanvasRenderingContext2D, curve: Curve, offset: number, width: number, fill: CanvasGradient) {
  context.beginPath();
  trace(context, curve, offset);
  trace(context, curve, offset + width, true);
  context.closePath();
  context.fillStyle = fill;
  context.fill();
}

/**
 * Paints the original artwork into the same canvas sampled by the material.
 * Time is in seconds and controlled by the caller so pausing freezes both views.
 */
export function createBackground(canvas: HTMLCanvasElement) {
  const canvasContext = canvas.getContext('2d', { alpha: false });
  if (!canvasContext) throw new Error('Unable to start the background canvas.');
  const context = canvasContext;
  let aspectRatio = 1;

  function resize(width: number, height: number, pixelRatio: number) {
    aspectRatio = width / Math.max(1, height);
    const pixelWidth = Math.max(1, Math.round(width * pixelRatio));
    const pixelHeight = Math.max(1, Math.round(height * pixelRatio));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  }

  function render(time = 0, audio = SILENT) {
    const narrow = Math.max(0, Math.min(1, (1.9 - aspectRatio) / 1.2));
    const phase = time * 0.16;
    const drift = Math.sin(phase) * 0.022 + audio.low * 0.011;
    const lift = Math.sin(phase * 0.68 + 0.8) * 0.014 + audio.mid * 0.009;

    const cobalt: Curve = [
      [-0.18, 0.96],
      [0.07, 0.87, 0.22 + narrow * 0.05, 0.36 + lift, 0.51, 0.36 + drift],
      [0.77, 0.35 + drift, 0.87, 0.38, 1.17, 0.06 + narrow * 0.2],
    ];
    const current: Curve = [
      [-0.18, 1.05 - narrow * 0.11],
      [0.09, 1.03, 0.29 - narrow * 0.08, 0.42 + lift, 0.53, 0.49 + drift],
      [0.78, 0.56 + drift, 0.91, 0.63 - narrow * 0.07, 1.16, 0.20 + narrow * 0.05],
    ];
    const fold: Curve = [
      [-0.18, 1.13 - narrow * 0.05],
      [0.12, 1.13, 0.33, 0.62 + lift, 0.55, 0.65 + drift],
      [0.79, 0.67 + drift, 0.87, 0.85, 1.17, 0.53],
    ];
    const undertow: Curve = [
      [-0.18, 1.19],
      [0.08, 1.18, 0.36, 0.89, 0.58, 0.85 + drift],
      [0.78, 0.81 + drift, 0.92, 1.08, 1.17, 0.91],
    ];

    context.setTransform(canvas.width, 0, 0, canvas.height, 0, 0);
    context.fillStyle = gradient(context, 0.12, 0, 0.85, 1, [
      [0, '#071226'],
      [0.36, '#0a1e44'],
      [0.7, '#0e3269'],
      [1, '#155579'],
    ]);
    context.fillRect(0, 0, 1, 1);
    glow(context, 0.63, 0.15, 0.58, 'rgba(19, 67, 141, 0.62)');
    glow(context, 0.83, 0.47, 0.5, 'rgba(23, 134, 181, 0.28)');

    sheet(context, cobalt, -0.043, gradient(context, 0, 0.36, 1, 0.71, [
      [0, '#0d214e'],
      [0.33, '#184782'],
      [0.64, '#153c81'],
      [1, '#0d3255'],
    ]));
    sheet(context, cobalt, 0, gradient(context, 0.08, 0.32, 0.82, 0.86, [
      [0, '#173d84'],
      [0.25, '#2059c0'],
      [0.52, '#297cce'],
      [0.72, '#1c72ab'],
      [1, '#0c375f'],
    ]));
    lightSheet(context, cobalt, 0, 0.62, 0.43 + drift, 0.43, 'rgba(64, 168, 255, 0.32)');
    lightSheet(context, cobalt, 0, 0.92, 0.52, 0.4, 'rgba(2, 49, 121, 0.31)');
    ribbon(context, cobalt, 0.004, 0.006, gradient(context, 0.18, 0.48, 1, 0.26, [
      [0, 'transparent'],
      [0.35, 'rgba(108, 189, 249, 0.50)'],
      [0.72, 'rgba(117, 213, 244, 0.28)'],
      [1, 'transparent'],
    ]));

    sheet(context, current, 0, gradient(context, 0.11, 0.71, 0.91, 0.53, [
      [0, '#133b89'],
      [0.27, '#288bca'],
      [0.52, '#42becb'],
      [0.74, '#1685ac'],
      [1, '#135577'],
    ]));
    lightSheet(context, current, 0, 0.56, 0.55 + drift, 0.29, 'rgba(102, 246, 244, 0.28)');
    ribbon(context, current, -0.011, 0.087, gradient(context, 0.04, 0.8, 0.98, 0.37, [
      [0, 'rgba(87, 190, 239, 0)'],
      [0.31, 'rgba(108, 206, 241, 0.22)'],
      [0.61, 'rgba(126, 240, 220, 0.24)'],
      [1, 'rgba(143, 221, 232, 0.08)'],
    ]));
    ribbon(context, current, 0.001, 0.027 + audio.energy * 0.004, gradient(context, 0.13, 0.7, 0.97, 0.48, [
      [0, 'rgba(151, 220, 239, 0.08)'],
      [0.29, 'rgba(181, 234, 238, 0.42)'],
      [0.54, 'rgba(248, 242, 208, 0.90)'],
      [0.73, 'rgba(211, 240, 222, 0.59)'],
      [1, 'rgba(140, 216, 223, 0.13)'],
    ]));
    ribbon(context, current, 0.001, 0.0028 + audio.high * 0.001, gradient(context, 0.2, 0.6, 0.88, 0.5, [
      [0, 'transparent'],
      [0.5, 'rgba(255, 248, 217, 0.95)'],
      [1, 'transparent'],
    ]));
    ribbon(context, current, 0.038, 0.0035, gradient(context, 0.25, 0.71, 0.89, 0.53, [
      [0, 'transparent'],
      [0.44, 'rgba(24, 118, 157, 0.59)'],
      [1, 'transparent'],
    ]));

    sheet(context, fold, -0.013, gradient(context, 0.12, 0.92, 0.9, 0.69, [
      [0, '#164e91'],
      [0.42, '#2b97b5'],
      [0.69, '#20899d'],
      [1, '#126580'],
    ]));
    sheet(context, fold, 0.008, gradient(context, 0.21, 0.58, 0.81, 1.04, [
      [0, '#143e9e'],
      [0.33, '#186096'],
      [0.61, '#14577d'],
      [1, '#0b3558'],
    ]));
    lightSheet(context, fold, 0.008, 0.61, 0.68 + drift, 0.50, 'rgba(39, 134, 205, 0.25)');
    ribbon(context, fold, 0.008, 0.004, gradient(context, 0.26, 0.9, 1, 0.66, [
      [0, 'transparent'],
      [0.42, 'rgba(109, 210, 215, 0.63)'],
      [1, 'transparent'],
    ]));

    sheet(context, undertow, 0, gradient(context, 0.12, 0.92, 1, 0.98, [
      [0, '#0c275e'],
      [0.4, '#103c76'],
      [0.76, '#142c63'],
      [1, '#0b244d'],
    ]));
    glow(context, 0.03, 0.28, 0.38, 'rgba(6, 17, 37, 0.61)');
    glow(context, 0.97, 0.08, 0.33, 'rgba(5, 19, 40, 0.34)');
  }

  return { canvas, resize, render };
}
