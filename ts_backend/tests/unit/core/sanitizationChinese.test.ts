/**
 * sanitizeUnicode 中文字符影响验证
 *
 * 验证 Unicode 清洗流程对中文内容的正确性：
 * - 简体中文应完整保留
 * - 繁体中文 NFKC 标准化行为
 * - 中文标点 NFKC 标准化行为（重要发现：全角兼容标点会被转为半角）
 * - CJK 扩展区字符不被误删
 * - 零宽字符 + 中文混合时仅移除零宽字符
 * - 全角数字/字母 NFKC 标准化行为
 *
 * 关键发现：
 * NFKC 标准化会将全角兼容标点（U+FF00-U+FFEF 区段）转为半角 ASCII：
 *   ，(U+FF0C) → ,(U+002C)   ！(U+FF01) → !(U+0021)
 *   ？(U+FF1F) → ?(U+003F)   （(U+FF08) → ((U+0028)
 *   ）(U+FF09) → )(U+0029)   …(U+2026) → ...(U+002E×3)
 * 但 CJK 专属标点不受影响：
 *   。(U+3002) 保留   、(U+3001) 保留
 *   「」(U+300C/U+300D) 保留   《》(U+300A/U+300B) 保留
 *   ——(U+2014) 保留
 */
import { describe, it, expect } from 'vitest';
import { sanitizeUnicode } from '../../../src/core/security/sanitization.js';

describe('sanitizeUnicode — 中文字符影响', () => {
  // ── 1. 简体中文 ──────────────────────────────────────────────
  it('应完整保留简体中文', () => {
    expect(sanitizeUnicode('你好世界')).toBe('你好世界');
  });

  it('应保留简体中文与英文混合文本', () => {
    expect(sanitizeUnicode('Hello 你好 World 世界')).toBe('Hello 你好 World 世界');
  });

  // ── 2. 繁体中文 ──────────────────────────────────────────────
  it('繁体中文 NFKC 标准化后应保持不变（繁简转换不在 NFKC 范围内）', () => {
    // NFKC 不做繁简转换，只处理兼容性分解
    // 常见繁体字如「國」「學」「開」在 Unicode 中是独立码点，不是兼容字符
    const traditional = '國際學術開發';
    expect(sanitizeUnicode(traditional)).toBe(traditional);
  });

  it('繁体中文汉字应完整保留', () => {
    const traditional = '體學開發國際';
    expect(sanitizeUnicode(traditional)).toBe(traditional);
  });

  // ── 3. 中文标点 ──────────────────────────────────────────────
  describe('中文标点', () => {
    it('CJK 专属标点应保留（。、等）', () => {
      // U+3002 ideo full stop, U+3001 ideo comma — 非兼容字符，NFKC 不变
      expect(sanitizeUnicode('、。')).toBe('、。');
    });

    it('CJK 引号和书名号应保留', () => {
      // U+300C/U+300D, U+300E/U+300F, U+300A/U+300B — 非兼容字符
      expect(sanitizeUnicode('「」『』《》')).toBe('「」『』《》');
    });

    it('破折号应保留', () => {
      // U+2014 em dash — 非兼容字符，NFKC 不变
      expect(sanitizeUnicode('——')).toBe('——');
    });

    it('全角兼容标点会被 NFKC 转为半角（，→, ！→! ？→?）', () => {
      // 全角逗号 U+FF0C、全角感叹号 U+FF01、全角问号 U+FF1F 属于兼容字符
      // NFKC 会将它们转为 ASCII 半角等价物
      expect(sanitizeUnicode('，')).toBe(',');
      expect(sanitizeUnicode('！')).toBe('!');
      expect(sanitizeUnicode('？')).toBe('?');
    });

    it('全角括号会被 NFKC 转为半角', () => {
      // U+FF08 → (, U+FF09 → )
      expect(sanitizeUnicode('（')).toBe('(');
      expect(sanitizeUnicode('）')).toBe(')');
    });

    it('省略号会被 NFKC 分解为三个点', () => {
      // U+2026 horizontal ellipsis → 三个 U+002E
      expect(sanitizeUnicode('…')).toBe('...');
    });

    it('中文句子中的全角标点会被 NFKC 转为半角', () => {
      // 注意：这是 NFKC 标准化的副作用，中文排版可能受影响
      const input = '你好，世界！今天天气不错。';
      const expected = '你好,世界!今天天气不错。';
      expect(sanitizeUnicode(input)).toBe(expected);
    });
  });

  // ── 4. CJK 扩展区字符 ────────────────────────────────────────
  it('应保留 CJK 统一表意文字扩展 A 区字符', () => {
    // 扩展 A 区：U+3400-U+4DBF（罕见汉字）
    const extA = '\u3447\u3448'; // 㑇 㑈
    expect(sanitizeUnicode(extA)).toBe(extA);
  });

  it('应保留 CJK 统一表意文字扩展 B 区字符', () => {
    // 扩展 B 区：U+20000-U+2A6DF（需要代理对）
    const extB = '\uD840\uDC00'; // U+20000 𠀀
    expect(sanitizeUnicode(extB)).toBe(extB);
  });

  it('应保留 CJK 兼容表意文字（NFKC 会规范化码点）', () => {
    // CJK 兼容区：U+F900-U+FAFF
    // NFKC 会将兼容字符分解为对应的统一汉字
    // 例如 U+F96C (塞) → U+585E (塞)
    const compat = '\uF96C';
    const result = sanitizeUnicode(compat);
    // NFKC 标准化后兼容汉字会被转换为对应的统一汉字
    // 这是预期行为：兼容字符的码点会被规范化
    expect(result.length).toBeGreaterThan(0);
  });

  // ── 5. 零宽字符 + 中文混合 ───────────────────────────────────
  it('应移除中文中的零宽空格，保留中文内容', () => {
    expect(sanitizeUnicode('你好\u200B世界')).toBe('你好世界');
  });

  it('应移除中文中的零宽非连接符，保留中文内容', () => {
    expect(sanitizeUnicode('你好\u200C世界')).toBe('你好世界');
  });

  it('应移除中文中的零宽连接符，保留中文内容', () => {
    expect(sanitizeUnicode('你好\u200D世界')).toBe('你好世界');
  });

  it('应移除中文中的 BOM，保留中文内容', () => {
    expect(sanitizeUnicode('\uFEFF你好世界')).toBe('你好世界');
  });

  it('应移除中文中的方向控制字符，保留中文内容', () => {
    expect(sanitizeUnicode('你好\u202E世界')).toBe('你好世界');
  });

  it('应移除多个零宽字符，保留中文内容', () => {
    expect(sanitizeUnicode('\u200B你好\u200C\u200D世界\uFEFF')).toBe('你好世界');
  });

  // ── 6. 全角数字/字母 ────────────────────────────────────────
  it('NFKC 应将全角数字转为半角', () => {
    // 全角数字 U+FF10-U+FF19 → 半角 0-9
    expect(sanitizeUnicode('１２３')).toBe('123');
  });

  it('NFKC 应将全角大写字母转为半角', () => {
    // 全角大写 U+FF21-U+FF3A → 半角 A-Z
    expect(sanitizeUnicode('ＡＢＣ')).toBe('ABC');
  });

  it('NFKC 应将全角小写字母转为半角', () => {
    // 全角小写 U+FF41-U+FF5A → 半角 a-z
    expect(sanitizeUnicode('ａｂｃ')).toBe('abc');
  });

  it('NFKC 应将全角数字字母混合转为半角', () => {
    expect(sanitizeUnicode('ＡＢＣ１２３')).toBe('ABC123');
  });

  // ── 7. 边界情况 ──────────────────────────────────────────────
  it('中文长文本中汉字应完整保留（标点可能被 NFKC 转换）', () => {
    // 使用 CJK 专属标点的句子应完全保留
    const textWithCjkPunct = '你好世界。今天天气不错、我们去散步吧';
    expect(sanitizeUnicode(textWithCjkPunct)).toBe(textWithCjkPunct);
  });

  it('应正确处理中文 + Emoji 混合', () => {
    // Emoji 不属于 Cf/Co/Cn，应保留
    expect(sanitizeUnicode('你好😀世界')).toBe('你好😀世界');
  });

  it('应正确处理中文 + 日文混合', () => {
    // 平假名和片假名不属于危险类别
    expect(sanitizeUnicode('你好こんにちは')).toBe('你好こんにちは');
  });
});
