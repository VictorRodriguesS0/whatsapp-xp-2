const graphemeSegmenter = new Intl.Segmenter("pt-BR", {
  granularity: "grapheme",
});

const extendedPictographicPattern = /\p{Extended_Pictographic}/u;
const flagPattern = /^\p{Regional_Indicator}{2}$/u;
const keycapPattern = /^[#*0-9]\uFE0F?\u20E3$/u;
const forbiddenPattern = /[\p{White_Space}\p{Cc}]/u;

const utf8Encoder = new TextEncoder();

export function isSingleEmoji(value: string): boolean {
  if (
    value.length === 0 ||
    utf8Encoder.encode(value).byteLength > 64 ||
    forbiddenPattern.test(value)
  ) {
    return false;
  }

  const graphemes = [...graphemeSegmenter.segment(value)];
  if (graphemes.length !== 1 || graphemes[0]?.segment !== value) {
    return false;
  }

  return (
    extendedPictographicPattern.test(value) ||
    flagPattern.test(value) ||
    keycapPattern.test(value)
  );
}
