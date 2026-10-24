// Execute only in a NEW empty Figma Design file. This creates synthetic fixtures.
// Intentional absolute positioning, overlaps and overflow are the test inputs.
if (figma.currentPage.children.length !== 0) throw new Error('Expected an empty test page; do not modify an existing source.');
const made=[];
const colors={white:[1,1,1],red:[1,0,0],green:[0,1,0],blue:[0,0,1],yellow:[1,1,0],orange:[1,0.5,0],magenta:[1,0,1],cyan:[0,1,1]};
const paint=c=>[{type:'SOLID',color:{r:colors[c][0],g:colors[c][1],b:colors[c][2]}}];
function frame(parent,name,x,y,w,h,fill='white') {const n=figma.createFrame();made.push(n);parent.appendChild(n);n.name=name;n.resize(w,h);n.x=x;n.y=y;n.layoutMode='NONE';n.fills=fill?paint(fill):[];n.clipsContent=false;return n;}
function rect(parent,name,x,y,w,h,color) {const n=figma.createRectangle();made.push(n);parent.appendChild(n);n.name=name;n.resize(w,h);n.x=x;n.y=y;n.fills=paint(color);n.strokes=[];return n;}
const root=frame(figma.currentPage,'Geometry and rendering lab',-800,-500,800,600);
const red=rect(root,'landmark red',20,20,100,80,'red');
const blue=rect(root,'landmark blue',600,450,120,100,'blue');
const clip=frame(root,'clipped overflow',220,120,120,100);clip.clipsContent=true;
rect(clip,'overflow orange',-30,30,200,40,'orange');
const masked=frame(root,'masked context',420,120,160,120,null);
const mask=figma.createEllipse();made.push(mask);masked.appendChild(mask);mask.name='ellipse alpha mask';mask.resize(80,80);mask.x=20;mask.y=10;mask.fills=paint('white');mask.isMask=true;mask.maskType='ALPHA';
const maskedShape=rect(masked,'masked cyan',0,0,140,100,'cyan');
const hidden=frame(root,'hidden ancestor',20,250,100,100,null);hidden.visible=false;
const hiddenChild=rect(hidden,'hidden red child',0,0,100,100,'red');
const transparent=frame(root,'zero opacity ancestor',140,250,100,100,null);transparent.opacity=0;
const transparentChild=rect(transparent,'transparent green child',0,0,100,100,'green');
const covered=frame(root,'equal bounds coverage',300,280,180,150,null);
const old=rect(covered,'covered red candidate',20,20,120,80,'red');
const cover=rect(covered,'covering blue candidate',20,20,120,80,'blue');
const branches=frame(root,'distant branch coverage',510,290,180,130,null);
const branchA=frame(branches,'branch A',0,0,180,130,null),branchB=frame(branches,'branch B',0,0,180,130,null);
const branchOld=rect(branchA,'branch magenta candidate',10,10,100,70,'magenta');
const branchNew=rect(branchB,'branch green candidate',10,10,100,70,'green');
const rotatedChild=rect(root,'rotated descendant',250,470,80,50,'magenta');rotatedChild.rotation=30;
const externalOverlay=rect(figma.currentPage,'external sibling overlay',-770,-470,30,30,'yellow');
const rotatedRoot=frame(figma.currentPage,'unsupported rotated root',200,-400,200,120);rotatedRoot.rotation=15;
rect(rotatedRoot,'rotation marker',20,20,60,60,'red');
const section=figma.createSection();made.push(section);section.name='Section export boundary';section.x=500;section.y=-500;section.resizeWithoutConstraints(400,300);section.fills=paint('white');
rect(section,'section origin marker',0,0,40,40,'red');
rect(section,'section far marker',360,260,40,40,'blue');
return {createdNodeIds:made.map(n=>n.id),pageId:figma.currentPage.id,
  roots:{geometry:root.id,rotated:rotatedRoot.id,section:section.id},
  targets:{red:red.id,blue:blue.id,clip:clip.id,masked:masked.id,mask:mask.id,maskedShape:maskedShape.id,hidden:hidden.id,hiddenChild:hiddenChild.id,transparent:transparent.id,transparentChild:transparentChild.id,covered:covered.id,old:old.id,cover:cover.id,branches:branches.id,branchOld:branchOld.id,branchNew:branchNew.id,rotatedChild:rotatedChild.id,externalOverlay:externalOverlay.id},
  nodes:made.map(n=>({id:n.id,type:n.type,name:n.name,parentId:n.parent?.id,bbox:n.absoluteBoundingBox}))};
