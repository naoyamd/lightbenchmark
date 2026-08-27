import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
const emoji = /\p{Extended_Pictographic}/u;

export function graphemeLength(text) {
  return [...segmenter.segment(text.trim())].length;
}
export function emojiCount(text) {
  return [...segmenter.segment(text)].filter(({ segment }) => emoji.test(segment)).length;
}

export function evaluateTurn1(text) {
  const normalized = text.trim();
  const chars = graphemeLength(normalized);
  const emojis = emojiCount(normalized);
  const checks = {
    length: chars >= 220 && chars <= 300,
    emoji: emojis >= 2 && emojis <= 4,
    separateCity: /(福岡市.{0,12}(別|ではなく|じゃなく)|糸島市.{0,12}(別|独立))/u.test(normalized),
    nature: /(海|玄界灘).*(山|滝|自然)|(山|滝|自然).*(海|玄界灘)/u.test(normalized),
    food: /(海産|魚|牡蠣|野菜|農産|畜産|食)/u.test(normalized),
    activity: /(散策|観光|登山|滝|海岸|ドライブ|サイクリング|カフェ)/u.test(normalized),
    practicalEnding: /(注意|確認|調べ|予約|時刻|移動|計画)[^。！？]*[。！？]?$/u.test(normalized),
  };
  return { chars, emojis, checks, formatPass: Object.values(checks).every(Boolean) };
}

export function evaluateTurn2(text) {
  const normalized = text.trim();
  const match = normalized.match(/^改稿:\s*([\s\S]*?)\s*自己点検:\s*([\s\S]+)$/u);
  const body = match?.[1]?.trim() ?? "";
  const selfCheck = match?.[2]?.trim() ?? "";
  const chars = graphemeLength(body);
  const emojis = emojiCount(body);
  const factIds = [...new Set(selfCheck.match(/F[1-6]/gu) ?? [])].sort();
  const checks = {
    structure: Boolean(match),
    length: chars >= 200 && chars <= 260,
    emoji: emojis >= 1 && emojis <= 3,
    separateCity: /(福岡市.{0,12}(別|ではなく|じゃなく)|隣接する別の市)/u.test(body),
    transportNuance: /(車|公共交通|時刻|目的地|移動)/u.test(body),
    factIds: factIds.includes("F1") && factIds.length >= 4,
    correctionAudit: /訂正・弱めた点\s*:/u.test(selfCheck),
    factIdLine: /使用Fact ID\s*:/u.test(selfCheck),
  };
  return { body, selfCheck, chars, emojis, factIds, checks, formatPass: Object.values(checks).every(Boolean) };
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
