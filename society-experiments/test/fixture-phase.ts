/** Synchronous fixture budget, independent of Bun hook-option support and its pinned type definitions. */
export function fixturePhase(register:(run:()=>void)=>void,budgetMs:number,run:()=>void){
    // Bun1.3.14 accepts the timeout argument; pinned bun-types1.2.15 omits it.
    // Keep this compatibility bridge local, alongside the independent wall-budget check.
    const timedRegister:(run:()=>void,timeout:number)=>void=register;
    timedRegister(()=>{const start=performance.now();let completed=false;
        try{run();completed=true;}finally{const elapsed=performance.now()-start;
            console.info('[fixture-phase]',JSON.stringify({budgetMs,wallMs:Math.round(elapsed)}));
            if(completed&&elapsed>budgetMs)throw Error(`Fixture phase exceeded ${budgetMs}ms: ${Math.round(elapsed)}ms`);}
    },budgetMs);
}

/** Async setup uses the same independent wall guard and local Bun hook compatibility bridge. */
export function asyncFixturePhase(register:(run:()=>Promise<void>)=>void,budgetMs:number,run:()=>Promise<void>){
    const timedRegister:(run:()=>Promise<void>,timeout:number)=>void=register;
    timedRegister(async()=>{const start=performance.now();let completed=false;
        try{await run();completed=true;}finally{const elapsed=performance.now()-start;
            console.info('[fixture-phase]',JSON.stringify({budgetMs,wallMs:Math.round(elapsed)}));
            if(completed&&elapsed>budgetMs)throw Error(`Fixture phase exceeded ${budgetMs}ms: ${Math.round(elapsed)}ms`);}
    },budgetMs);
}
