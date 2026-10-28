/**
 * 从任务模式跳回实验台时的参数来源提示。
 *
 * 参数只回填一次，之后控件就归用户；「还原默认」用 replaceState 静默清掉查询串，
 * 不写 location.hash——那会再触发一次 hashchange，把默认值又写回控件。
 */
export function FromQuestionNote(props: { text: string; onRestore: () => void }) {
  return (
    <div className="from-question" role="note">
      <p>{props.text}</p>
      <button type="button" className="from-question-restore" onClick={props.onRestore}>
        还原默认
      </button>
    </div>
  )
}
