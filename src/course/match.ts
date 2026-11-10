/**
 * 章名 → 主题标识的匹配（纯函数，没有任何副作用）。
 *
 * 用途：拿到一行目录页上的章名（教材原字、可能带「第三章」前缀、可能夹空格和标点），
 * 判断它说的是本项目 13 章仿真里的哪一章。匹配不上就老老实实返回 null，
 * 不许「差不多就当它命中」——猜错一章比不认更糟。
 *
 * 打分规则：命中的关键词越长分越高（长词更具体）；整条章名与某个关键词完全一样
 * 额外加 1000 分，优先级最高。同一个主题命中多个写法时取自己最分高的那条，
 * 跨主题比较时若分数与词长都一样，取关键词表里靠前的那个（保证同一输入永远同一结果）。
 */

export type MatchResult = {
  /** 命中的主题标识，等于 course.ts 里那一章的 `no`。 */
  topicId: string
  /** 命中的分数：关键词长度，整条完全相同再加 1000。 */
  score: number
}

/** 关键词表：一条写法对应一个主题，同一主题可以有多种写法。 */
type Keyword = {
  word: string
  topicId: string
}

/** 整条章名与关键词完全一致时的加分，比任何长度都高。 */
const EXACT_BONUS = 1000

/**
 * 关键词表。
 *
 * 第一组是《通信原理》13 章的原名；后面几组是《信号与系统》《信息论与编码》
 * 里能真正映射到现有仿真的章名写法，以及教材里常见的同义叫法。
 * 词只加「能指认这一章」的，不加「很多章都沾边」的——泛词会让无关章名误命中。
 */
const KEYWORDS: Keyword[] = [
  // 第 1 章 绪论
  { word: '绪论', topicId: '1' },
  { word: '引论', topicId: '1' },
  { word: '绪言', topicId: '1' },
  { word: '概述', topicId: '1' },

  // 第 2 章 确知信号
  { word: '确知信号', topicId: '2' },
  { word: '确定性信号', topicId: '2' },
  { word: '信号分析', topicId: '2' },

  // 第 3 章 随机过程
  { word: '随机过程', topicId: '3' },
  { word: '随机信号', topicId: '3' },
  { word: '平稳随机', topicId: '3' },
  { word: '窄带随机', topicId: '3' },
  { word: '白噪声', topicId: '3' },

  // 第 4 章 信道
  { word: '信道模型', topicId: '4' },
  { word: '信道容量', topicId: '4' },
  { word: '恒参信道', topicId: '4' },
  { word: '随参信道', topicId: '4' },
  { word: '信道', topicId: '4' },
  { word: '通道', topicId: '4' },

  // 第 5 章 模拟调制系统
  { word: '模拟调制系统', topicId: '5' },
  { word: '模拟调制', topicId: '5' },
  { word: '角度调制', topicId: '5' },
  { word: '幅度调制', topicId: '5' },
  { word: '双边带', topicId: '5' },
  { word: '单边带', topicId: '5' },
  { word: '残留边带', topicId: '5' },
  { word: '调幅', topicId: '5' },
  { word: '调频', topicId: '5' },

  // 第 6 章 数字基带传输系统
  { word: '数字基带传输系统', topicId: '6' },
  { word: '数字基带传输', topicId: '6' },
  { word: '基带传输', topicId: '6' },
  { word: '线路码型', topicId: '6' },
  { word: '码间串扰', topicId: '6' },
  { word: '升余弦', topicId: '6' },
  { word: '眼图', topicId: '6' },
  { word: '基带', topicId: '6' },

  // 第 7 章 数字带通传输系统
  { word: '数字带通传输系统', topicId: '7' },
  { word: '数字带通传输', topicId: '7' },
  { word: '带通传输', topicId: '7' },
  { word: '频带传输', topicId: '7' },
  { word: '2dpsk', topicId: '7' },
  { word: '2psk', topicId: '7' },
  { word: '2fsk', topicId: '7' },
  { word: '2ask', topicId: '7' },
  { word: '键控', topicId: '7' },

  // 第 8 章 新型数字带通调制技术
  { word: '新型数字带通调制技术', topicId: '8' },
  { word: '新型数字带通调制', topicId: '8' },
  { word: '数字带通调制', topicId: '8' },
  { word: '正交幅度调制', topicId: '8' },
  { word: '正交频分复用', topicId: '8' },
  { word: '最小频移键控', topicId: '8' },
  { word: 'ofdm', topicId: '8' },
  { word: 'qam', topicId: '8' },
  { word: 'msk', topicId: '8' },

  // 第 9 章 数字信号的最佳接收
  { word: '数字信号的最佳接收', topicId: '9' },
  { word: '最佳接收机', topicId: '9' },
  { word: '最佳接收', topicId: '9' },
  { word: '匹配滤波器', topicId: '9' },
  { word: '匹配滤波', topicId: '9' },
  { word: '最大似然', topicId: '9' },

  // 第 10 章 信源编码
  { word: '信源编码', topicId: '10' },
  { word: '脉冲编码调制', topicId: '10' },
  { word: '抽样定理', topicId: '10' },
  { word: '增量调制', topicId: '10' },
  { word: '量化', topicId: '10' },
  { word: 'pcm', topicId: '10' },
  { word: 'a律', topicId: '10' },

  // 第 11 章 差错控制编码
  { word: '差错控制编码', topicId: '11' },
  { word: '差错控制', topicId: '11' },
  { word: '纠错编码', topicId: '11' },
  { word: '信道编码', topicId: '11' },
  { word: '线性分组码', topicId: '11' },
  { word: '汉明码', topicId: '11' },
  { word: '卷积码', topicId: '11' },
  { word: '循环码', topicId: '11' },
  { word: '检错', topicId: '11' },

  // 第 12 章 正交编码与伪随机序列
  { word: '正交编码与伪随机序列', topicId: '12' },
  { word: '伪随机序列', topicId: '12' },
  { word: '正交编码', topicId: '12' },
  { word: 'm序列', topicId: '12' },
  { word: '伪随机', topicId: '12' },
  { word: '沃尔什', topicId: '12' },
  { word: '巴克码', topicId: '12' },
  { word: '扩频', topicId: '12' },

  // 第 13 章 同步原理
  { word: '同步原理', topicId: '13' },
  { word: '载波同步', topicId: '13' },
  { word: '位同步', topicId: '13' },
  { word: '群同步', topicId: '13' },
  { word: '帧同步', topicId: '13' },
  { word: '网同步', topicId: '13' },
  { word: '同步', topicId: '13' },
]

/** 去掉「第X章 / 第X节 / 第X部分」前缀，再去掉空白与标点，只留能比对的字。 */
function normalize(rawTitle: string): string {
  return rawTitle
    .trim()
    .toLowerCase()
    .replace(/^第[一二三四五六七八九十百零〇\d]+(章|节|部分)/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/** 关键词与输入都在归一化后的形态上比较，所以关键词表里存小写。 */
const NORMALIZED_KEYWORDS: Keyword[] = KEYWORDS.map(({ word, topicId }) => ({
  word: normalize(word),
  topicId,
}))

function scoreOf(text: string, word: string): number {
  if (word.length < 2) return 0
  if (text === word) return EXACT_BONUS + word.length
  return text.includes(word) ? word.length : 0
}

/**
 * 拿一行章名去匹配主题。
 *
 * @returns 命中时返回主题标识与分数；匹配不上返回 null（不硬凑）。
 */
export function matchChapter(rawTitle: string): MatchResult | null {
  const text = normalize(rawTitle)
  if (!text) return null

  let best: { topicId: string; score: number; length: number } | null = null
  for (const { word, topicId } of NORMALIZED_KEYWORDS) {
    const score = scoreOf(text, word)
    if (score === 0) continue
    // 分数一样时取更长的词；词长也一样就保留先出现的（表序即优先级）。
    if (!best || score > best.score || (score === best.score && word.length > best.length)) {
      best = { topicId, score, length: word.length }
    }
  }

  return best ? { topicId: best.topicId, score: best.score } : null
}
