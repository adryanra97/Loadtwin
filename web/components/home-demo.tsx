"use client";

import { useState } from "react";
import { TwinHero } from "./twin-hero";

/** Simulations only start after the visitor explicitly opens the playground. */
export function HomeDemo(){
  const [open,setOpen]=useState(false);
  return <div className="lt-home-demo" id="lt-home-demo-content">
    {!open ? <div className="lt-home-demo-idle">
      <div className="lt-demo-emblem" aria-hidden="true"><span/><span/><span/></div>
      <div><strong>Ready to explore a live scenario?</strong><p>Launch the playground when you&apos;re ready. It uses the simulation engine and the service currently saved in your browser.</p></div>
      <button type="button" className="lt-demo-start" aria-expanded={false} aria-controls="lt-home-demo-content" onClick={()=>setOpen(true)}>Launch playground <span aria-hidden="true">↗</span></button>
    </div> : <div className="lt-home-demo-active">
      <div className="lt-home-demo-toolbar"><span>LIVE SIMULATION · YOUR SAVED SERVICE</span><button type="button" onClick={()=>setOpen(false)} aria-expanded={true} aria-controls="lt-home-demo-content">Close playground ×</button></div>
      <TwinHero/>
    </div>}
  </div>;
}
