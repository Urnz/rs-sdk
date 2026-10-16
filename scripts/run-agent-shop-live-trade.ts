import { runScript } from '../sdk/runner.js';
import { mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';

const mode=process.argv.includes('--prepare')?'prepare':process.argv.includes('--seller')?'seller':
    process.argv.includes('--prepare-supplier')?'prepare-supplier':process.argv.includes('--buyer')?'buyer':
        process.argv.includes('--supplier')?'supplier':process.argv.includes('--stock-receiver')?'stock-receiver':null;
const workShift=process.argv.includes('--work-shift')||process.argv.includes('--work-shift-2');
const workShiftReceipt=process.argv.includes('--work-shift-2')?'work-shift-2':'work-shift';
if(!mode&&!workShift)throw new Error('Unknown live shop pilot mode');

const result=await runScript(async({bot,sdk})=>{
    if(workShift){const state=sdk.getState(),startedAt=new Date().toISOString();if(!state||state.player.worldX<3205||state.player.worldX>3218
        ||state.player.worldZ<3238||state.player.worldZ>3255)throw new Error('Shop clerk is outside the live shop facility');
        const startPosition={x:state.player.worldX,z:state.player.worldZ},deadline=Date.now()+65_000;let ticks=0;
        while(Date.now()<deadline){await sdk.waitForTicks(1);ticks++}const final=sdk.getState();
        if(!final)throw new Error('Shop clerk state disappeared');return{mode:workShiftReceipt,startedAt,completedAt:new Date().toISOString(),
            startPosition,endPosition:{x:final.player.worldX,z:final.player.worldZ},ticks}}
    if(mode==='prepare'||mode==='prepare-supplier'){
        const target=mode==='prepare'?5:6;if(mode==='prepare-supplier'){const walked=await bot.walkTo(3213,3245,8);
            if(!walked.success)throw new Error(walked.message)}
        const current=sdk.countInventoryItems(/^hammer$/i);if(current>target)throw new Error('Pilot actor has excess hammers');
        if(current<target){const opened=await bot.openShop(/^shop (keeper|assistant)$/i);if(!opened.success)throw new Error(opened.message);
            const bought=await bot.buyFromShop(/^hammer$/i,target-current,{maxUnitPrice:10});if(!bought.success)throw new Error(bought.message);
            await bot.closeShop()}
        const finalCount=sdk.countInventoryItems(/^hammer$/i);if(finalCount!==target)throw new Error(`Expected ${target} hammers, observed ${finalCount}`);
        return{mode,hammers:finalCount,coins:sdk.countInventoryItems(/^coins$/i)}
    }
    if(mode==='seller'){const served=await bot.serveTrades({from:/^vrworker1$/i,give:[{item:/^hammer$/i,amount:3}],
        want:[{item:/^coins$/i,amount:15}],maxTrades:1,tradeTimeout:60_000,timeout:180_000});
        if(!served.success||served.trades.filter(trade=>trade.success).length!==1)throw new Error(served.message);return{mode,served,
            hammers:sdk.countInventoryItems(/^hammer$/i),coins:sdk.countInventoryItems(/^coins$/i)}}
    if(mode==='supplier'){const traded=await bot.trade(/^vrtrader1$/i,{give:[{item:/^hammer$/i,amount:6}],
        requestTimeout:60_000,timeout:60_000,retryOnBusy:true});if(!traded.success)throw new Error(traded.message);
        return{mode,traded,hammers:sdk.countInventoryItems(/^hammer$/i),coins:sdk.countInventoryItems(/^coins$/i)}}
    if(mode==='stock-receiver'){const served=await bot.serveTrades({from:/^vrworker1$/i,want:[{item:/^hammer$/i,amount:6}],
        maxTrades:1,tradeTimeout:60_000,timeout:180_000});if(!served.success||served.trades.filter(trade=>trade.success).length!==1)
            throw new Error(served.message);return{mode,served,hammers:sdk.countInventoryItems(/^hammer$/i),
                coins:sdk.countInventoryItems(/^coins$/i)}}
    const walked=await bot.walkTo(3213,3245,8);if(!walked.success)throw new Error(walked.message);
    const traded=await bot.trade(/^vrtrader1$/i,{give:[{item:/^coins$/i,amount:15}],want:[{item:/^hammer$/i,amount:3}],
        requestTimeout:60_000,timeout:60_000,retryOnBusy:true});if(!traded.success)throw new Error(traded.message);
    return{mode,traded,hammers:sdk.countInventoryItems(/^hammer$/i),coins:sdk.countInventoryItems(/^coins$/i)}
},{timeout:200_000,printState:true});
if(!result.success)process.exitCode=1;else if(mode!=='prepare'&&mode!=='prepare-supplier'){
    const directory=join(import.meta.dir,'..','.local','economy','agent-shop-live');mkdirSync(directory,{recursive:true});
    const receiptMode=workShift?workShiftReceipt:mode!;writeFileSync(join(directory,`${receiptMode}.json`),JSON.stringify({schemaVersion:1,
        mode:receiptMode,completedAt:new Date().toISOString(),
        result:result.result},null,2)+'\n',{encoding:'utf8',flag:'wx'})}
