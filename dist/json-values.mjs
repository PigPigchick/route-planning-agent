// JSONB may return object properties in a different order. Arrays retain order.
const serialize=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)
 ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
export const jsonEqual=(left,right)=>serialize(left)===serialize(right);
