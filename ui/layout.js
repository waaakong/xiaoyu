// Keep existing controls and event handlers; give adjacent actions a real gap
// and a wrapping container instead of relying on inline whitespace.
export function wrapActions(root){
  const selector='.page,.cognition-panel,.form-section,.wechat-advanced';
  const panels=[...(root.matches?.(selector)?[root]:[]),...root.querySelectorAll(selector)];
  for(const panel of panels){
    let group=[];
    const flush=()=>{if(!group.length)return;const row=panel.ownerDocument.createElement('div');row.className='action-row';panel.insertBefore(row,group[0]);for(const control of group)row.append(control);group=[];};
    for(const child of [...panel.children]){
      if(child.matches('button,a')&&!child.hidden)group.push(child);
      else flush();
    }
    flush();
  }
}
