// Prints a read-only script for the official Figma use_figma tool. It is not a
// replacement for the product adapter or Figma Desktop integration testing.
// Target: 4dKjnCZ8lTY8fVXUugJGxP. No document or selection writes.
process.stdout.write(`
const results = [];
for (const id of ['1:2', '1:58', '1:75']) {
  const root = await figma.getNodeByIdAsync(id);
  const start = Date.now(), stack = [root];
  let count = 0, textNodes = 0;
  while (stack.length && count < 500) {
    const node = stack.pop(); count++;
    if (node.type === 'TEXT') textNodes++;
    if ('children' in node) for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
  }
  const traversalMs = Date.now() - start, bounds = root.absoluteBoundingBox;
  let image = null, error = null;
  const imageStart = Date.now();
  try {
    const png = await root.exportAsync({format:'PNG', contentsOnly:true, useAbsoluteBounds:true,
      constraint:{type:'SCALE', value:Math.min(1,2048/Math.max(bounds.width,bounds.height))}});
    const uint32 = i => png[i]*16777216 + png[i+1]*65536 + png[i+2]*256 + png[i+3];
    image = {bytes:png.length, width:uint32(16), height:uint32(20)};
  } catch (e) { error = String(e).slice(0,300); }
  results.push({id,count,textNodes,complete:stack.length===0,bounds,traversalMs,
    exportMs:Date.now()-imageStart,image,error});
}
return {probe:'bounded direct Plugin API export, not bundled product adapter or Desktop bridge',
  mutatedNodeIds:[],memory:'not measured',results};
`);
