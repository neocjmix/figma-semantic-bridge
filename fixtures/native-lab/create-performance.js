// Add these only to the dedicated synthetic lab after create-geometry.js.
const top=figma.currentPage.children;
if(!top.some(n=>n.name==='Geometry and rendering lab')||top.some(n=>n.name.startsWith('Performance ')))throw new Error('Expected the geometry lab with no existing performance scopes.');
const createdNodeIds=[],roots=[];
for(const [index,count] of [100,1000,5000].entries()){
  const frame=figma.createFrame();createdNodeIds.push(frame.id);frame.name=`Performance ${count} rectangles`;frame.resize(600,600);frame.x=1100+index*700;frame.y=-500;frame.layoutMode='NONE';frame.clipsContent=true;frame.fills=[{type:'SOLID',color:{r:1,g:1,b:1}}];
  const columns=Math.ceil(Math.sqrt(count)),cell=580/columns;
  for(let i=0;i<count;i++){
    const n=figma.createRectangle();createdNodeIds.push(n.id);frame.appendChild(n);n.name=`cell ${i}`;n.resize(cell*0.8,cell*0.8);n.x=10+(i%columns)*cell;n.y=10+Math.floor(i/columns)*cell;n.fills=[{type:'SOLID',color:{r:(i%7)/7,g:(i%11)/11,b:(i%13)/13}}];n.strokes=[];
  }
  roots.push({id:frame.id,count:count+1,bbox:frame.absoluteBoundingBox});
}
// CSV keeps every affected ID below the remote tool's 48 KB result ceiling.
return {createdNodeIdsCsv:createdNodeIds.join(','),createdNodeCount:createdNodeIds.length,roots,pageId:figma.currentPage.id};
