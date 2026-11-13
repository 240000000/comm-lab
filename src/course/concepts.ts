/**
 * 13 个实验（课程视图 13 章）的概念词表与切节打分。
 *
 * 这一层只做词面匹配：不引模型、不联网、不依赖分词库。
 * 每个实验 20–40 个词/符号，命中次数累加成 score，取前三名。
 */

export type Topic = {
  topicId: string
  title: string
  terms: string[]
}

export type TopicScore = {
  topicId: string
  score: number
  hits: string[]
}

export const TOPICS: Topic[] = [
  {
    topicId: 'ch01',
    title: '绪论：通信系统与基本概念',
    terms: [
      '通信系统', '信源', '信宿', '信道', '噪声', '带宽', '误码率', '比特', '符号',
      '调制', '解调', '编码', '译码', '频谱', '功率', '信噪比', '传输', '模拟', '数字',
      '采样', '量化', '复用', '频带', '基带', '载波', '干扰',
    ],
  },
  {
    topicId: 'ch02',
    title: '确知信号：频谱与相关',
    terms: [
      '确知信号', '能量信号', '功率信号', '傅里叶', '频谱', '谱密度', '自相关', '互相关',
      '卷积', '冲激', '阶跃', '周期', '谐波', '带宽', '矩形脉冲', '三角脉冲', '指数',
      '相位', '频率', '欧拉', '采样定理', '帕塞瓦尔', '时域', '频域', '信号能量',
    ],
  },
  {
    topicId: 'ch03',
    title: '随机过程：白噪声与统计描述',
    terms: [
      '随机过程', '均值', '方差', '自相关', '平稳', '各态历经', '高斯', '白噪声', '窄带',
      '功率谱', '瑞利', '莱斯', '分布', '概率', '随机变量', '统计', '相关函数', '独立',
      '正交', '马尔可夫', '随机', '噪声',
    ],
  },
  {
    topicId: 'ch04',
    title: '信道：衰落、多径与容量',
    terms: [
      '信道', '加性', '乘性', '白噪声', '衰落', '多径', '时延', '失真', '带宽', '香农',
      '容量', '信噪比', '传输函数', '冲激响应', '相干', '非相干', '恒参', '变参',
      '路径损耗', '多普勒', '频率选择性',
    ],
  },
  {
    topicId: 'ch05',
    title: '模拟调制：AM / DSB / SSB / FM',
    terms: [
      '幅度调制', 'AM', 'DSB', 'SSB', 'FM', 'PM', '调制度', '载波', '边带', '带宽',
      '解调', '包络', '鉴频', '鉴相', '信噪比', '门限', '预加重', '去加重', '频分复用',
      '调制指数', '单边带', '双边带',
    ],
  },
  {
    topicId: 'ch06',
    title: '数字基带传输：眼图与码间串扰',
    terms: [
      '基带', '码元', '码间串扰', 'ISI', '奈奎斯特', '滚降', '升余弦', '眼图', '均衡',
      '抽样', '判决', '误码率', '波特率', '带宽', '线路编码', '极性', '单极性', '双极性',
      '归零', '曼彻斯特', '码元速率', '频谱效率',
    ],
  },
  {
    topicId: 'ch07',
    title: '数字带通传输：2ASK / 2FSK / 2PSK',
    terms: [
      '2ASK', '2FSK', '2PSK', '2DPSK', '调制', '解调', '相干', '非相干', '误码率',
      '带宽', '频带利用率', '相位', '载波', '包络', '判决', '星座', '信噪比', '门限',
      '差分', '键控', '带通',
    ],
  },
  {
    topicId: 'ch08',
    title: '新型数字带通：QAM 与 OFDM',
    terms: [
      'QAM', '16QAM', '64QAM', 'QPSK', 'BPSK', '星座', '欧氏距离', '误码率', '信噪比',
      'Es/N0', '星座图', '映射', '格雷码', 'OFDM', '子载波', '峰均比', '频带利用率',
      '误符号率', '理论曲线', 'EVM', '循环前缀',
    ],
  },
  {
    topicId: 'ch09',
    title: '最佳接收：匹配滤波与最大似然',
    terms: [
      '匹配滤波', '相关器', '最大似然', '判决门限', '误码率', '白噪声', '信号能量',
      '相关', '抽样', '最佳', '似然函数', '先验概率', '最小错误', '积分', '输出信噪比',
      '匹配', '滤波器', '波形', '最佳接收',
    ],
  },
  {
    topicId: 'ch10',
    title: '信源编码：采样、量化与压缩',
    terms: [
      '信源编码', '采样', '量化', 'PCM', '编码', '压缩', '熵', '哈夫曼', '量化误差',
      '码率', '失真', '预测', '差分', '语音', '图像', '均匀量化', '非均匀', '对数',
      'A律', 'μ律', '量化噪声',
    ],
  },
  {
    topicId: 'ch11',
    title: '差错控制：汉明码与卷积码',
    terms: [
      '差错控制', '汉明码', '最小距离', '伴随式', '校验位', '纠错', '检错', '线性分组码',
      '生成矩阵', '校验矩阵', '卷积码', '维特比', '自由距离', '硬判决', '软判决',
      '编码增益', '码率', '约束长度', '生成多项式', '状态', '网格', '纠错能力',
    ],
  },
  {
    topicId: 'ch12',
    title: '正交编码与伪随机序列',
    terms: [
      '正交', '伪随机', 'm 序列', '自相关', '互相关', '周期', '本原多项式', '抽头',
      '移位寄存器', '沃尔什', '正交码', '码分', 'CDMA', '扩频', '平衡性', '峰值',
      '旁瓣', '延迟', '级数', '伪随机序列',
    ],
  },
  {
    topicId: 'ch13',
    title: '同步原理：载波、位与帧同步',
    terms: [
      '同步', '载波同步', '位同步', '群同步', '帧同步', '相位', '频偏', '锁相环', 'PLL',
      '鉴相器', '压控振荡器', '环路', '捕捉', '跟踪', '抖动', '时钟', '定时', '相位差',
      '收敛', '失锁', 'VCO', '相位抖动',
    ],
  },
]

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '')
}

/** 纯 ASCII 的短词（AM、PM、ISI）按词边界数，别让 QAM 里的 AM 冒充幅度调制。 */
const LATIN_TERM = /^[a-z0-9][a-z0-9./+_-]*$/

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function countTerm(haystack: string, term: string): number {
  const needle = normalize(term)
  if (!needle) return 0
  if (LATIN_TERM.test(needle)) {
    const pattern = new RegExp(`(?<![a-z0-9])${escapeRegExp(needle)}(?![a-z0-9])`, 'g')
    return haystack.match(pattern)?.length ?? 0
  }
  let from = 0
  let count = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) break
    count += 1
    from = at + needle.length
  }
  return count
}

/** 纯函数：给一段正文，返回命中最多的前三个实验。 */
export function scoreSection(text: string): TopicScore[] {
  const haystack = normalize(text)
  const scored = TOPICS.map((topic) => {
    const hits: string[] = []
    let score = 0
    for (const term of topic.terms) {
      const count = countTerm(haystack, term)
      if (count > 0) {
        hits.push(term)
        score += count
      }
    }
    return { topicId: topic.topicId, score, hits }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 3)
}
