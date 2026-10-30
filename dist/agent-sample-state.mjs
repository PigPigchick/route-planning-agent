import {SAMPLE,clone,makeTask} from './engine.mjs';

export const SAMPLE_AGENT_TYPES=['comparison','compliance','description'];
export function shouldShowAgentSample(context,type){
 return SAMPLE_AGENT_TYPES.includes(type)&&(!context?.project?.id||context.contextType==='letters');
}
export function runAgentSample(state,type){
 if(!SAMPLE_AGENT_TYPES.includes(type))throw new Error('该页面不使用样例任务');
 const ids=type==='comparison'?state.selected:[state.routeId];
 const task=makeTask(state.context,type,ids,state.weights);
 task.id='AGENT-SAMPLE-'+type;task.isSample=true;
 state.tasks=[task,...state.tasks.filter(item=>item.agentType!==type)];
 return task;
}
export function createAgentSample(){
 const context=clone(SAMPLE);
 const state={context,routeId:context.routes[0].id,selected:context.routes.map(r=>r.id),weights:{economy:50,ecology:30,construction:20},issueId:context.issues[0]?.id,tasks:[]};
 for(const type of SAMPLE_AGENT_TYPES)runAgentSample(state,type);
 return state;
}
