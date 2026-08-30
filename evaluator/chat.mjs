import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
const emoji = /\p{Extended_Pictographic}/u;
const IDS = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"];
const EXPECTED_LABELS = Object.freeze({ S1: "誤", S2: "正", S3: "正", S4: "誤", S5: "正", S6: "誤", S7: "正", S8: "誤" });

export function graphemeLength(text) {
  return [...segmenter.segment(text.trim())].length;
}

export function emojiCount(text) {
  return [...segmenter.segment(text)].filter(({ segment }) => emoji.test(segment)).length;
}

function extractLabels(text) {
  return Object.fromEntries(IDS.map((id) => {
    const match = text.match(new RegExp(`(?:^|\\n)\\s*${id}\\s*[:：は]?\\s*[（(]?(正|誤)[）)]?(?=\\s|[—―ー:：、，,。.!！？()（）]|$)`, "mu"));
    return [id, match?.[1] ?? null];
  }));
}

function labelChecks(labels) {
  return Object.fromEntries(IDS.map((id) => [id, labels[id] === EXPECTED_LABELS[id]]));
}

const correctionChecks = Object.freeze({
  S1: /糸島市[\s\S]{0,35}(福岡市の?一部ではない|福岡市とは別|別の自治体|別の市)/u,
  S2: /厳島神社[\s\S]{0,35}宮島[\s\S]{0,35}廿日市市|宮島[\s\S]{0,35}廿日市市/u,
  S3: /松本城[\s\S]{0,35}(現存天守[\s\S]{0,12})?国宝/u,
  S4: /(最小|いちばん小さい)[\s\S]{0,35}香川県/u,
  S5: /琵琶湖[\s\S]{0,45}(自然流出|自然に流れ出る|自然に流出|流出)[\s\S]{0,30}瀬田川/u,
  S6: /青森ねぶた[\s\S]{0,45}弘前ねぷた[\s\S]{0,35}(別の祭|別祭|同じではない|異なる祭|別々)/u,
  S7: /(東経135度|標準時子午線)[\s\S]{0,35}(兵庫県)?明石市/u,
  S8: /浜名湖[\s\S]{0,35}(汽水湖|海水と淡水)/u,
});

function correctionResults(text) {
  return Object.fromEntries(IDS.map((id) => [id, correctionChecks[id].test(text)]));
}

function formatResult(text, { minChars, maxChars, minEmoji, maxEmoji }) {
  const chars = graphemeLength(text);
  const emojis = emojiCount(text);
  const checks = {
    length: chars >= minChars && chars <= maxChars,
    emoji: emojis >= minEmoji && emojis <= maxEmoji,
  };
  return { chars, emojis, checks, pass: Object.values(checks).every(Boolean) };
}

export function evaluateTurn1(text) {
  const normalized = text.trim();
  const labels = extractLabels(normalized);
  const checks = labelChecks(labels);
  const truthPass = Object.values(checks).every(Boolean);
  const format = formatResult(normalized, { minChars: 240, maxChars: 560, minEmoji: 2, maxEmoji: 6 });
  return {
    labels,
    expectedLabels: EXPECTED_LABELS,
    checks,
    truthPass,
    chars: format.chars,
    emojis: format.emojis,
    formatChecks: format.checks,
    formatPass: format.pass,
  };
}

export function evaluateTurn2(text) {
  const normalized = text.trim();
  const match = normalized.match(/^改稿:\s*([\s\S]*?)\s*自己点検:\s*([\s\S]+)$/u);
  const body = match?.[1]?.trim() ?? "";
  const selfCheck = match?.[2]?.trim() ?? "";
  const labels = extractLabels(body);
  const labelResults = labelChecks(labels);
  const corrections = correctionResults(body);
  const factIds = [...new Set(selfCheck.match(/F[1-8]/gu) ?? [])].sort();
  const correctionIds = [...new Set(selfCheck.match(/S[1-8]/gu) ?? [])].sort();
  const format = formatResult(body, { minChars: 220, maxChars: 560, minEmoji: 1, maxEmoji: 4 });
  const checks = {
    structure: Boolean(match),
    truthLabels: Object.values(labelResults).every(Boolean),
    corrections: Object.values(corrections).every(Boolean),
    factIds: IDS.every((_, index) => factIds.includes(`F${index + 1}`)),
    correctionAudit: /訂正(?:・確認)?\s*:/u.test(selfCheck) && ["S1", "S4", "S6", "S8"].every((id) => correctionIds.includes(id)),
  };
  return {
    body,
    selfCheck,
    labels,
    expectedLabels: EXPECTED_LABELS,
    factIds,
    correctionIds,
    corrections,
    checks,
    truthPass: checks.truthLabels && checks.corrections && checks.factIds && checks.correctionAudit,
    chars: format.chars,
    emojis: format.emojis,
    formatChecks: { ...format.checks, structure: checks.structure },
    formatPass: format.pass && checks.structure,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) {
    throw new Error("Usage: node evaluator/chat.mjs <turn1.txt> <turn2.txt>");
  }
  const [turn1, turn2] = await Promise.all([
    readFile(process.argv[2], "utf8"),
    readFile(process.argv[3], "utf8"),
  ]);
  console.log(JSON.stringify({ turn1: evaluateTurn1(turn1), turn2: evaluateTurn2(turn2) }, null, 2));
}
