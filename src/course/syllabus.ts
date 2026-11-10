/**
 * 教材目录（数据层）。
 *
 * 这里只放「书 → 章」这一层的静态事实：教材原名、章序号，以及映射到本项目
 * 13 章仿真里的主题标识。页码、小节标题这些要读过目录页才知道的东西，
 * 留给下一轮由真实解析结果注入——手抄数字是会出偏差的，这一轮一个都不写。
 *
 * `topicId` 不另造命名空间：它就是 `src/core/course.ts` 里每章的 `no`，
 * 转成字符串是给后面按主题查表用的。
 */

export type BookChapter = {
  /** 教材里的章序号，从 1 起。 */
  no: number
  /** 教材原字，不带「第N章」这类前缀。 */
  rawTitle: string
  /** 对应课程视图里的主题标识，等于 course.ts 里那一章的 `no`。 */
  topicId: string
}

export type Book = {
  /** 书的稳定标识，别用书名当键。 */
  id: string
  /** 书的原名。 */
  title: string
  chapters: BookChapter[]
}

/** 章号就是主题标识，只在这里转一次，免得两处各写一遍。 */
function chapter(no: number, rawTitle: string): BookChapter {
  return { no, rawTitle, topicId: String(no) }
}

/**
 * 《通信原理》的 13 章，按教材顺序。
 * 章名照抄教材，不加前缀、不缩写——后面拿它去对目录页上的原字。
 */
export const BOOK_COMMUNICATION: Book = {
  id: 'communication-principles',
  title: '通信原理',
  chapters: [
    chapter(1, '绪论'),
    chapter(2, '确知信号'),
    chapter(3, '随机过程'),
    chapter(4, '信道'),
    chapter(5, '模拟调制系统'),
    chapter(6, '数字基带传输系统'),
    chapter(7, '数字带通传输系统'),
    chapter(8, '新型数字带通调制技术'),
    chapter(9, '数字信号的最佳接收'),
    chapter(10, '信源编码'),
    chapter(11, '差错控制编码'),
    chapter(12, '正交编码与伪随机序列'),
    chapter(13, '同步原理'),
  ],
}
