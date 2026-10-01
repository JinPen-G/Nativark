import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd";
import { motion } from "motion/react";
import { SidebarMenu } from "../../apps/admin/src/components/ui/SidebarMenu";
function Harness() {
  const [selected,setSelected]=useState("one"),[collapsed,setCollapsed]=useState(false);
  const children=Array.from({length:16},(_,i)=>({key:i===0?"one":String(i),label:`Item ${i+1}`}));
  return <ConfigProvider><button onClick={()=>setCollapsed(v=>!v)}>Collapse fixture</button>
    <motion.div layoutScroll className="sider-nav" style={{width:collapsed?64:240,height:260}}>
      <SidebarMenu mode="inline" inlineCollapsed={collapsed} selectedKeys={[selected]}
        items={collapsed?[{key:"group",label:"Group",children}]:[{type:"group",key:"group",label:"Group",children}]}
        onClick={({key})=>setSelected(key)}/>
    </motion.div><output>{selected}</output></ConfigProvider>;
}
document.querySelectorAll("#sidebar-fixture").forEach(node=>node.remove());
const mount=document.createElement("section");mount.id="sidebar-fixture";
mount.style.cssText="position:fixed;inset:0;z-index:500;background:var(--background);padding:40px";
document.body.appendChild(mount);createRoot(mount).render(<Harness/>);
