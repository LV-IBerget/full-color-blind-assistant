import { segmentClothing } from "./clothingSegmenter";
import { clothingMask } from "./core/clothingMask";
import { nearestNames, searchColors, type LookupColor } from "./core/colorLookup";
import { colorMatch, describeColor, FAMILY_REACH, familyMatch, percent } from "./core/colorMatch";
import { surveyNames, type ColorSurvey } from "./core/colorSurvey";
import { colorName, familyBand, HUE_FAMILIES, lean, type HueFamily } from "./core/colorVocabulary";
import { OkLab, type LinearRgb } from "./core/oklab";
import { imageSearchUrl } from "./core/imageSearch";
import { analyzeOutfit, COPY, NO_RESULT, type CoordinationResult } from "./core/outfitCoordination";
import { describeRelative, sampleCenterAndSurround } from "./core/relativeColor";
import { applyGains, gainsFromWhite, NO_CORRECTION, type Gains } from "./core/whiteReference";
import { HueHatch, type HatchTarget } from "./hueHatch";
import "./style.css";

const SAMPLE_INTERVAL_MS = 250;
const SAMPLE_SIDE = 32;

// The square around the reticle that gets sampled, as a fraction of the image's shorter side.
// The color read is the middle of this square, about 3% of that side across, small enough to land on
// one color in a pattern rather than blending several.
const SAMPLE_REGION = 0.2;

// How far one arrow key press moves the reticle, as a fraction of the image.
const KEY_STEP = 0.02;

const NOTE_DURATION_MS = 5000;

// Smooths camera noise so the words do not flicker between frames.
const SMOOTHING = 0.35;

// Photos are capped to this size, and analyzed stretched to the model's own input size.
const MAX_PHOTO_SIDE = 1280;
const MODEL_SIDE = 256;

// The hatching canvas renders at no more than this many pixels per CSS pixel, which keeps phones with
// very dense screens smooth while the image fills the screen.
const MAX_PIXEL_RATIO = 2;

// Space kept between a photo and the controls around it. Below the minimum height, as on a phone held
// sideways, a photo uses the whole screen instead.
const OPEN_AREA_MARGIN = 8;
const MIN_OPEN_HEIGHT = 160;

type HatchMode = "off" | "all" | "lookup" | HueFamily["name"];

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const stage = element("stage");
const frame = element("frame");
const video = element<HTMLVideoElement>("video");
const stillCanvas = element<HTMLCanvasElement>("still");
const hatchCanvas = element<HTMLCanvasElement>("hatch");
const reticle = element("reticle");
const topBar = document.querySelector<HTMLElement>(".top")!;
const bottomBar = document.querySelector<HTMLElement>(".bottom")!;
const emptyState = element("empty");
const startCameraButton = element<HTMLButtonElement>("camera-start");
const cameraSwitch = element<HTMLButtonElement>("camera-switch");
const hatchToggle = element<HTMLButtonElement>("hatch-toggle");
const hatchLabel = element("hatch-label");
const hatchMenu = element("hatch-menu");
const key = element("key");
const legend = document.getElementById("legend") as unknown as SVGSVGElement;
const matchKey = element("match-key");
const matchKeyTitle = element("match-key-title");
const readout = element("readout");
const colorNameLabel = element("color-name");
const alsoLabel = element("also");
const matchLabel = element("match");
const relativeLabel = element("relative");
const resultPanel = element("result");
const resultHeadline = element("result-headline");
const resultDetail = element("result-detail");
const noteLabel = element("note");
const pinButton = element<HTMLButtonElement>("pin");
const whiteButton = element<HTMLButtonElement>("white");
const photoButton = element<HTMLButtonElement>("photo");
const fileInput = element<HTMLInputElement>("photo-file");
const cameraInput = element<HTMLInputElement>("photo-camera");
const lookupOpen = element<HTMLButtonElement>("lookup-open");
const lookupDialog = element<HTMLDialogElement>("lookup");
const lookupClose = element<HTMLButtonElement>("lookup-close");
const lookupInput = element<HTMLInputElement>("lookup-input");
const lookupResults = element<HTMLUListElement>("lookup-results");
const lookupEmpty = element("lookup-empty");
const lookupHere = element<HTMLUListElement>("lookup-here");
const lookupHereEmpty = element("lookup-here-empty");

const sampleContext = createCanvasContext(SAMPLE_SIDE, SAMPLE_SIDE);
const modelContext = createCanvasContext(MODEL_SIDE, MODEL_SIDE);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const hatch = HueHatch.create(hatchCanvas);

let stream: MediaStream | null = null;
let cameras: MediaDeviceInfo[] = [];
let showingStill = false;
let hatchMode: HatchMode = "off";
let hatchLoop = 0;
let lookupTarget: LookupColor | null = null;

// What people call colors, from the C3 survey model. Loaded after the page is up, and optional.
let survey: ColorSurvey | null = null;

// Where the reticle is, from 0 to 1 across the image.
let point = { x: 0.5, y: 0.5 };
let reticleNeedsPlacing = true;
let draggingReticle = false;

// Readings stay in linear light, so setting or clearing white also updates a color pinned earlier.
let reading: { target: LinearRgb; surround: LinearRgb } | null = null;
let pinned: LinearRgb | null = null;

let gains: Gains = NO_CORRECTION;
let whiteIsSet = false;
let photoIsFromFile = false;
let noteTimer = 0;

// Newer photos replace older analyses. A result arriving late for a stale run is dropped.
let analysisRun = 0;

function createCanvasContext(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext("2d", { willReadFrequently: true })!;
}

function capitalize(text: string): string {
  return text[0].toUpperCase() + text.slice(1);
}

// ---- What is on screen ----

function currentSource(): { image: HTMLVideoElement | HTMLCanvasElement; width: number; height: number } | null {
  if (showingStill) return { image: stillCanvas, width: stillCanvas.width, height: stillCanvas.height };
  if (stream && video.videoWidth > 0) return { image: video, width: video.videoWidth, height: video.videoHeight };
  return null;
}

function refreshView(): void {
  const source = currentSource();
  const live = !showingStill && stream !== null;

  video.hidden = !live;
  stillCanvas.hidden = !showingStill;
  reticle.hidden = !source;
  frame.hidden = !source && !live;
  emptyState.hidden = source !== null || live;

  photoButton.classList.toggle("is-close", showingStill);
  photoButton.setAttribute("aria-label", showingStill ? "Back to camera" : "Take photo");

  fitFrame();
  applyHatchMode();
}

/**
 * The live camera fills the screen and crops its edges, like a camera app. A photo shows whole, in the
 * open space between the top and bottom controls, since the outfit in it may reach its edges.
 */
function fitFrame(): void {
  const source = currentSource();
  if (!source) return;

  const view = stage.getBoundingClientRect();
  const open = openArea();
  const usesOpenArea = showingStill && open.bottom - open.top >= MIN_OPEN_HEIGHT;
  const area = usesOpenArea ? { width: view.width, height: open.bottom - open.top } : view;

  const fit = showingStill ? Math.min : Math.max;
  const scale = fit(area.width / source.width, area.height / source.height);
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  frame.style.top = usesOpenArea ? `${(open.top + open.bottom) / 2 - view.top}px` : "50%";

  const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  hatchCanvas.width = Math.round(width * pixelRatio);
  hatchCanvas.height = Math.round(height * pixelRatio);

  if (reticleNeedsPlacing) {
    reticleNeedsPlacing = false;
    placeReticle(openAreaCenter());
  } else {
    placeReticle(point);
  }
}

// ---- Camera ----

async function startCamera(deviceId?: string): Promise<void> {
  stopCamera();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    await listCameras();
  } catch (reason) {
    // Denied or absent. Photos still work, and the empty state offers the camera again.
    console.warn("Camera:", reason);
    stopCamera();
  }

  // A white reference describes the light one camera saw.
  clearWhite();
  resetReading();
  centerReticle();
  refreshView();
}

function stopCamera(): void {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
}

async function listCameras(): Promise<void> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  cameras = devices.filter((device) => device.kind === "videoinput");
  cameraSwitch.hidden = cameras.length < 2;
}

function switchCamera(): void {
  const activeId = stream?.getVideoTracks()[0]?.getSettings().deviceId;
  const index = cameras.findIndex((camera) => camera.deviceId === activeId);
  const next = cameras[(index + 1) % cameras.length];
  if (next) void startCamera(next.deviceId);
}

// ---- Reading the color ----

function sampleFrame(): void {
  const source = currentSource();
  if (!source) {
    showReading(null);
    return;
  }

  // Near an edge this reaches past the image, which leaves those pixels transparent and so skipped.
  const side = Math.min(source.width, source.height) * SAMPLE_REGION;
  const left = point.x * source.width - side / 2;
  const top = point.y * source.height - side / 2;

  sampleContext.clearRect(0, 0, SAMPLE_SIDE, SAMPLE_SIDE);
  sampleContext.drawImage(source.image, left, top, side, side, 0, 0, SAMPLE_SIDE, SAMPLE_SIDE);
  const { data } = sampleContext.getImageData(0, 0, SAMPLE_SIDE, SAMPLE_SIDE);
  const { center, surround } = sampleCenterAndSurround(data, SAMPLE_SIDE);

  reading = reading
    ? { target: blend(reading.target, center), surround: blend(reading.surround, surround) }
    : { target: center, surround };
  showReading(reading);
}

function blend(from: LinearRgb, to: LinearRgb): LinearRgb {
  return [
    from[0] + (to[0] - from[0]) * SMOOTHING,
    from[1] + (to[1] - from[1]) * SMOOTHING,
    from[2] + (to[2] - from[2]) * SMOOTHING,
  ];
}

function corrected(color: LinearRgb): OkLab {
  return OkLab.fromLinear(applyGains(color, gains));
}

function showReading(current: typeof reading): void {
  pinButton.disabled = !current && !pinned;
  whiteButton.disabled = !current && !whiteIsSet;

  // An empty card would only cover the image.
  readout.hidden = !current;
  if (!current) {
    colorNameLabel.textContent = "";
    alsoLabel.textContent = "";
    matchLabel.textContent = "";
    relativeLabel.textContent = "";
    return;
  }

  const target = corrected(current.target);
  const name = colorName(target);
  colorNameLabel.textContent = capitalize(name);
  alsoLabel.textContent = alsoText(name, target, applyGains(current.target, gains));
  matchLabel.textContent = matchText(target);
  relativeLabel.textContent = pinned
    ? `Against pinned color: ${describeRelative(target, corrected(pinned))}`
    : `Against surroundings: ${describeRelative(target, corrected(current.surround))}`;
}

/**
 * Which way a neutral leans, and what else people call the color. "Leans yellow. Also called tan,
 * cream." Either part is left out when it has nothing to add.
 */
function alsoText(name: string, color: OkLab, linear: LinearRgb): string {
  const parts: string[] = [];
  const leaning = lean(color);
  if (leaning) parts.push(`Leans ${leaning}.`);

  if (survey) {
    const others = surveyNames(survey, linear)
      .map((entry) => entry.name)
      .filter((other) => other !== name)
      .slice(0, 3);
    if (others.length) parts.push(`Also called ${others.join(", ")}.`);
  }
  return parts.join(" ");
}

async function loadSurvey(): Promise<void> {
  try {
    const response = await fetch("./color-survey.json");
    if (!response.ok) return;
    survey = (await response.json()) as ColorSurvey;
    showReading(reading);
  } catch (reason) {
    // The readout works without it.
    console.warn("Color survey:", reason);
  }
}

/** How closely the reticle's color matches what the hatching is showing, when it shows one thing. */
function matchText(color: OkLab): string {
  const family = selectedFamily();
  if (family) return `${family.name} match: ${percent(familyMatch(color, family))}`;
  if (hatchMode === "lookup" && lookupTarget) {
    return `${capitalize(lookupTarget.name)} match: ${percent(colorMatch(color, lookupTarget.color))}`;
  }
  return "";
}

function resetReading(): void {
  reading = null;
}

function togglePin(): void {
  pinned = pinned ? null : (reading?.target ?? null);
  pinButton.textContent = pinned ? "Unpin color" : "Pin color";
  pinButton.setAttribute("aria-pressed", String(pinned !== null));
  showReading(reading);
}

// ---- Choosing where to read ----

/** The part of the image not cut off by the screen's edges, from 0 to 1 across the image. */
function visibleBounds(): { left: number; right: number; top: number; bottom: number } {
  const box = frame.getBoundingClientRect();
  const view = stage.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return { left: 0, right: 1, top: 0, bottom: 1 };
  return {
    left: Math.max(0, (view.left - box.left) / box.width),
    right: Math.min(1, (view.right - box.left) / box.width),
    top: Math.max(0, (view.top - box.top) / box.height),
    bottom: Math.min(1, (view.bottom - box.top) / box.height),
  };
}

/** The band of screen between the top controls and the bottom ones, in page pixels. */
function openArea(): { top: number; bottom: number } {
  const view = stage.getBoundingClientRect();
  const covered = [...bottomBar.children]
    .filter((child) => child instanceof HTMLElement && child.offsetParent !== null)
    .map((child) => child.getBoundingClientRect().top);
  return {
    top: topBar.getBoundingClientRect().bottom + OPEN_AREA_MARGIN,
    bottom: Math.min(view.bottom, ...covered) - OPEN_AREA_MARGIN,
  };
}

/** The middle of the open area, so the reticle starts in sight. */
function openAreaCenter(): { x: number; y: number } {
  const box = frame.getBoundingClientRect();
  const view = stage.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return { x: 0.5, y: 0.5 };

  const { top, bottom } = openArea();
  const y = bottom > top ? (top + bottom) / 2 : view.top + view.height / 2;
  return { x: (view.left + view.width / 2 - box.left) / box.width, y: (y - box.top) / box.height };
}

function placeReticle({ x, y }: { x: number; y: number }): void {
  const bounds = visibleBounds();
  point = {
    x: Math.min(bounds.right, Math.max(bounds.left, x)),
    y: Math.min(bounds.bottom, Math.max(bounds.top, y)),
  };
  reticle.style.left = `${point.x * 100}%`;
  reticle.style.top = `${point.y * 100}%`;
}

/** Puts the reticle back in the open middle once the new image is laid out. */
function centerReticle(): void {
  reticleNeedsPlacing = true;
}

/** Reads the new spot right away, with no smoothing from the spot it left. */
function moveReticle(x: number, y: number): void {
  placeReticle({ x, y });
  resetReading();
  sampleFrame();
}

function moveReticleToPointer(event: PointerEvent): void {
  const box = frame.getBoundingClientRect();
  moveReticle((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
}

function moveReticleWithKey(event: KeyboardEvent): void {
  const steps: Record<string, [number, number]> = {
    ArrowLeft: [-KEY_STEP, 0],
    ArrowRight: [KEY_STEP, 0],
    ArrowUp: [0, -KEY_STEP],
    ArrowDown: [0, KEY_STEP],
  };
  const step = steps[event.key];
  if (!step) return;

  event.preventDefault();
  moveReticle(point.x + step[0], point.y + step[1]);
}

// ---- White reference ----

function showNote(text: string): void {
  noteLabel.textContent = text;
  clearTimeout(noteTimer);
  noteTimer = window.setTimeout(() => {
    noteLabel.textContent = "";
  }, NOTE_DURATION_MS);
}

function setGains(next: Gains, isSet: boolean): void {
  gains = next;
  whiteIsSet = isSet;
  whiteButton.textContent = isSet ? "Clear white" : "Set white";
  whiteButton.setAttribute("aria-pressed", String(isSet));
  showReading(reading);
}

/**
 * Holds the camera's own white balance while a white reference is set, where the browser allows it.
 * Otherwise the camera rebalances as the view changes: aim at a wall filling the frame and it neutralizes
 * the wall, undoing the correction the reference made.
 */
function setCameraWhiteBalance(locked: boolean): void {
  const track = stream?.getVideoTracks()[0];
  if (!track || typeof track.getCapabilities !== "function") return;

  const modes = (track.getCapabilities() as { whiteBalanceMode?: string[] }).whiteBalanceMode ?? [];
  const mode = locked ? "manual" : "continuous";
  if (!modes.includes(mode)) return;

  const constraint: Record<string, unknown> = { whiteBalanceMode: mode };
  const temperature = (track.getSettings() as { colorTemperature?: number }).colorTemperature;
  if (locked && temperature) constraint.colorTemperature = temperature;
  track.applyConstraints({ advanced: [constraint] } as MediaTrackConstraints).catch((reason) => {
    console.warn("White balance:", reason);
  });
}

function clearWhite(): void {
  setGains(NO_CORRECTION, false);
  setCameraWhiteBalance(false);

  // A note about the old reference would now contradict the button.
  clearTimeout(noteTimer);
  noteLabel.textContent = "";
}

function toggleWhite(): void {
  if (whiteIsSet) {
    clearWhite();
    showNote("White reference cleared.");
  } else {
    if (!reading) return;

    const next = gainsFromWhite(reading.target);
    if (!next) {
      showNote("Set white works from a lighter spot with less color.");
      return;
    }
    setGains(next, true);
    if (!showingStill) setCameraWhiteBalance(true);
    showNote("White set. Readings now correct for this light.");
  }

  // Anything already reported on the photo used the old correction.
  if (showingStill) void analyzeStill();
}

// ---- Hatching ----

function selectedFamily(): HueFamily | undefined {
  return HUE_FAMILIES.find(({ name }) => name === hatchMode);
}

function hatchTarget(): HatchTarget | null {
  const family = selectedFamily();
  if (family) {
    const { center, halfWidth } = familyBand(family);
    return { kind: "family", hue: center, reach: halfWidth * FAMILY_REACH };
  }
  if (hatchMode === "lookup" && lookupTarget) return { kind: "color", color: lookupTarget.color };
  return null;
}

function setHatchMode(mode: HatchMode): void {
  hatchMode = mode;
  closeHatchMenu();
  applyHatchMode();
  showReading(reading);
}

function hatchModeLabel(): string {
  if (hatchMode === "off") return "Hatching off";
  if (hatchMode === "all") return "Hatching: all colors";
  if (hatchMode === "lookup" && lookupTarget) return `Finding: ${lookupTarget.name}`;
  return `Hatching: ${hatchMode}`;
}

function applyHatchMode(): void {
  const on = hatchMode !== "off" && hatch !== null && currentSource() !== null;
  const showsMatch = hatchMode !== "off" && hatchMode !== "all";

  hatchLabel.textContent = hatchModeLabel();
  hatchCanvas.hidden = !on;
  key.hidden = !on;
  legend.toggleAttribute("hidden", showsMatch);
  matchKey.hidden = !showsMatch;

  matchKeyTitle.textContent = hatchMode === "lookup" && lookupTarget ? capitalize(lookupTarget.name) : hatchMode;

  cancelAnimationFrame(hatchLoop);
  if (on) hatchLoop = requestAnimationFrame(drawHatch);
}

function drawHatch(now: number): void {
  const source = currentSource();
  if (!source || !hatch) return;

  const seconds = reducedMotion.matches ? 0 : now / 1000;
  hatch.draw(source.image, source.width, source.height, seconds, hatchTarget(), gains);
  hatchLoop = requestAnimationFrame(drawHatch);
}

function buildLegend(): void {
  const namespace = "http://www.w3.org/2000/svg";
  for (const { name, hue } of HUE_FAMILIES) {
    const radians = (hue * Math.PI) / 180;

    // Each spoke points the way that hue's lines flow. SVG's y axis points down, the shader's up.
    const x = Math.cos(radians);
    const y = -Math.sin(radians);

    const spoke = document.createElementNS(namespace, "g");

    const line = document.createElementNS(namespace, "line");
    line.setAttribute("x1", String(x * 12));
    line.setAttribute("y1", String(y * 12));
    line.setAttribute("x2", String(x * 62));
    line.setAttribute("y2", String(y * 62));
    line.setAttribute("marker-end", "url(#arrow)");

    const label = document.createElementNS(namespace, "text");
    label.setAttribute("x", String(x * 120));
    label.setAttribute("y", String(y * 94));
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "middle");
    label.textContent = name;

    spoke.append(line, label);
    legend.append(spoke);
  }

  hatchToggle.hidden = hatch === null;
}

function buildHatchMenu(): void {
  const modes: Array<[HatchMode, string]> = [
    ["off", "Off"],
    ["all", "All colors"],
    ...HUE_FAMILIES.map(({ name }): [HatchMode, string] => [name, name]),
  ];
  if (lookupTarget) modes.push(["lookup", `Find: ${lookupTarget.name}`]);

  hatchMenu.replaceChildren(
    ...modes.map(([mode, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.textContent = label;
      button.setAttribute("aria-pressed", String(mode === hatchMode));
      button.addEventListener("click", () => setHatchMode(mode));
      return button;
    }),
  );
}

function openHatchMenu(): void {
  buildHatchMenu();
  hatchMenu.hidden = false;
  hatchToggle.setAttribute("aria-expanded", "true");
  hatchMenu.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
}

function closeHatchMenu(): void {
  if (hatchMenu.hidden) return;
  hatchMenu.hidden = true;
  hatchToggle.setAttribute("aria-expanded", "false");
}

// ---- Color lookup ----

/**
 * Opens on the color at the reticle as it is right now, with the closest names for it, each linking to
 * Google Images. Typing a name instead looks that color up the same way.
 */
function openLookup(): void {
  closeHatchMenu();
  renderHere(reading ? applyGains(reading.target, gains) : null);
  lookupInput.value = "";
  renderLookup();
  lookupDialog.showModal();
}

function renderHere(linear: LinearRgb | null): void {
  lookupHereEmpty.hidden = linear !== null;
  if (!linear) {
    lookupHere.replaceChildren();
    return;
  }

  // The app's own word for the color comes first, so the search matches what the readout says. The
  // survey's closest names follow, for searches in the words shops and labels use.
  const color = OkLab.fromLinear(linear);
  const { name } = describeColor(color);
  const own: LookupColor = { name, hex: linearToHex(linear), color };
  const others = nearestNames(color, 3).filter((named) => named.name !== name);

  lookupHere.replaceChildren(...[own, ...others].slice(0, 3).map(lookupRow));
}

function linearToHex(linear: LinearRgb): string {
  const encode = (channel: number) => {
    const c = Math.min(1, Math.max(0, channel));
    const value = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${linear.map(encode).join("")}`;
}

function renderLookup(): void {
  const query = lookupInput.value.trim();
  const colors = query ? searchColors(query) : [];
  lookupEmpty.hidden = !query || colors.length > 0;
  lookupResults.replaceChildren(...colors.map(lookupRow));
}

/** A named color with a link to images of it, and a button to find it in the image here. */
function lookupRow(color: LookupColor): HTMLLIElement {
  const { name, tone } = describeColor(color.color);

  const swatch = document.createElement("span");
  swatch.className = "result-swatch";
  swatch.style.backgroundColor = color.hex;

  const title = document.createElement("span");
  title.className = "result-name";
  title.textContent = capitalize(color.name);

  const description = document.createElement("span");
  description.className = "result-tone";
  description.textContent = `${name}, ${tone}`;

  const text = document.createElement("span");
  text.append(title, description);

  const link = document.createElement("a");
  link.className = "lookup-link";
  link.href = imageSearchUrl(color.name, color.color);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", `Images of ${color.name}, on Google Images, in a new tab`);
  const action = document.createElement("span");
  action.className = "lookup-action";
  action.append("Images", externalIcon());
  link.append(swatch, text, action);

  const item = document.createElement("li");
  item.className = "lookup-row";
  item.append(link);

  if (hatch && currentSource()) {
    const find = document.createElement("button");
    find.type = "button";
    find.className = "chip";
    find.textContent = "Find";
    find.setAttribute("aria-label", `Find ${color.name} in the image`);
    find.addEventListener("click", () => chooseLookup(color));
    item.append(find);
  }
  return item;
}

function externalIcon(): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(namespace, "svg");
  icon.setAttribute("class", "icon external");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(namespace, "path");
  path.setAttribute("d", "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5");
  icon.append(path);
  return icon;
}

function chooseLookup(color: LookupColor): void {
  lookupTarget = color;
  lookupDialog.close();

  const { name, tone } = describeColor(color.color);
  if (hatch) setHatchMode("lookup");
  showNote(`${capitalize(color.name)} reads as ${name}: ${tone}.`);
}

// ---- Photos ----

function showWorking(): void {
  resultPanel.hidden = false;
  resultHeadline.textContent = COPY.working;
  resultDetail.textContent = "";
}

function showResult(result: CoordinationResult): void {
  resultPanel.hidden = false;
  resultHeadline.textContent = result.headline;
  resultDetail.textContent = result.detail ?? "";
}

function capture(): void {
  stillCanvas.width = video.videoWidth;
  stillCanvas.height = video.videoHeight;
  stillCanvas.getContext("2d")!.drawImage(video, 0, 0);
  photoIsFromFile = false;
  enterStill();
}

function enterStill(): void {
  showingStill = true;
  video.pause();
  resetReading();
  centerReticle();
  showWorking();
  refreshView();
  void analyzeStill();
}

async function loadPhoto(file: File): Promise<void> {
  const run = ++analysisRun;
  showWorking();

  // Decoding through an image element applies the photo's EXIF rotation. The file is read here in the
  // page and goes nowhere else.
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (run !== analysisRun) return;

    const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    stillCanvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    stillCanvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    stillCanvas.getContext("2d")!.drawImage(image, 0, 0, stillCanvas.width, stillCanvas.height);

    // A chosen photo was taken in some other light.
    photoIsFromFile = true;
    clearWhite();
    enterStill();
  } catch (reason) {
    console.warn("Photo:", reason);
    if (run === analysisRun) showResult(NO_RESULT);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function analyzeStill(): Promise<void> {
  const run = ++analysisRun;
  showWorking();

  // Inference blocks the page, so give the browser a moment to paint the message first.
  await new Promise((resolve) => setTimeout(resolve, 30));

  let result = NO_RESULT;
  try {
    modelContext.drawImage(stillCanvas, 0, 0, MODEL_SIDE, MODEL_SIDE);
    const { data } = modelContext.getImageData(0, 0, MODEL_SIDE, MODEL_SIDE);

    const confidence = await segmentClothing(modelContext.canvas);
    if (confidence) {
      // The mask must line up with the pixels it describes.
      const aligned = confidence.width === MODEL_SIDE && confidence.height === MODEL_SIDE;
      if (aligned) result = analyzeOutfit(data, clothingMask(confidence.values, MODEL_SIDE, MODEL_SIDE), gains);
    }
  } catch (reason) {
    console.warn("Clothing model:", reason);
  }

  if (run === analysisRun) showResult(result);
}

function leaveStill(): void {
  analysisRun++;
  showingStill = false;
  resultPanel.hidden = true;

  // White set on a captured photo still describes the camera's light. On a chosen photo it does not.
  if (photoIsFromFile) clearWhite();
  resetReading();
  centerReticle();
  if (stream) void video.play();
  refreshView();
}

function photoChosen(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  // Clearing it lets someone choose the same file twice in a row.
  input.value = "";
  if (file) void loadPhoto(file);
}

// ---- Wiring ----

photoButton.addEventListener("click", () => {
  if (showingStill) leaveStill();
  else if (stream && video.videoWidth > 0) capture();
  else cameraInput.click();
});
fileInput.addEventListener("change", photoChosen);
cameraInput.addEventListener("change", photoChosen);
pinButton.addEventListener("click", togglePin);
whiteButton.addEventListener("click", toggleWhite);
frame.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  draggingReticle = true;
  moveReticleToPointer(event);
});
window.addEventListener("pointermove", (event) => {
  if (draggingReticle) moveReticleToPointer(event);
});
window.addEventListener("pointerup", () => {
  draggingReticle = false;
});
window.addEventListener("pointercancel", () => {
  draggingReticle = false;
});
frame.addEventListener("keydown", moveReticleWithKey);
startCameraButton.addEventListener("click", () => void startCamera());
cameraSwitch.addEventListener("click", switchCamera);

hatchToggle.addEventListener("click", () => (hatchMenu.hidden ? openHatchMenu() : closeHatchMenu()));
document.addEventListener("pointerdown", (event) => {
  const target = event.target as Node;
  if (!hatchMenu.contains(target) && !hatchToggle.contains(target)) closeHatchMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !hatchMenu.hidden) {
    closeHatchMenu();
    hatchToggle.focus();
  }
});

lookupOpen.addEventListener("click", openLookup);
lookupClose.addEventListener("click", () => lookupDialog.close());
lookupInput.addEventListener("input", renderLookup);
lookupInput.addEventListener("keydown", (event) => {
  // A search box would spend the first Escape clearing itself. Here Escape always closes the sheet.
  if (event.key === "Escape") {
    event.preventDefault();
    lookupDialog.close();
  }
  if (event.key !== "Enter") return;
  event.preventDefault();
  lookupResults.querySelector("a")?.click();
});
// A tap on the dimmed backdrop, outside the sheet, closes it.
lookupDialog.addEventListener("click", (event) => {
  const box = lookupDialog.getBoundingClientRect();
  const outside =
    event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
  if (event.target === lookupDialog && outside) lookupDialog.close();
});

video.addEventListener("loadedmetadata", refreshView);
// The bottom controls grow when a result arrives, which changes the space a photo fits in.
const layoutObserver = new ResizeObserver(() => fitFrame());
layoutObserver.observe(stage);
layoutObserver.observe(bottomBar);
setInterval(sampleFrame, SAMPLE_INTERVAL_MS);

buildLegend();
refreshView();
void startCamera();
void loadSurvey();
