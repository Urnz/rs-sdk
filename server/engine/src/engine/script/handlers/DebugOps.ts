import { CoordGrid } from '#/engine/CoordGrid.js';
import { openExchange } from '#/engine/market/GrandExchange.js';
import { ScriptOpcode } from '#/engine/script/ScriptOpcode.js';
import { CommandHandlers } from '#/engine/script/ScriptRunner.js';
import { legacyShopAllowed } from '#/mods/ShopEconomyPolicy.js';
import { beginThievingEvidence, commitThievingEvidence } from '#/mods/ThievingEvidence.js';
import { getPropertyRuntime } from '#/mods/PropertyRuntime.js';
import Environment from '#/util/Environment.js';

const DebugOps: CommandHandlers = {
    [ScriptOpcode.GE_OPEN]: state => {
        const { level, x, z } = CoordGrid.unpackCoord(state.popInt());
        if (level === 0) openExchange(state.activePlayer, x, z);
    },
    [ScriptOpcode.ERROR]: state => {
        throw new Error(state.popString());
    },

    [ScriptOpcode.CONSOLE]: state => {
        console.log(state.popString());
    },

    [ScriptOpcode.MAP_RANDOM_EVENTS]: state => {
        state.pushInt(Environment.NODE_RANDOM_EVENTS ? 1 : 0);
    },

    [ScriptOpcode.SHOP_LEGACY_ALLOWED]: state => {
        state.pushInt(legacyShopAllowed(Environment.node.shopEconomyMode) ? 1 : 0);
    },

    [ScriptOpcode.THIEVING_EVIDENCE_BEGIN]: state => {
        beginThievingEvidence(state, state.popInt());
    },

    [ScriptOpcode.THIEVING_EVIDENCE_COMMIT]: state => {
        try {
            commitThievingEvidence(state, state.popInt());
        } catch (error) {
            // Evidence is fail-closed: never mint a receipt from an incomplete observation, but do not
            // turn an already completed vanilla interaction into a production logout.
            console.error(`[ThievingEvidence] ${error instanceof Error ? error.message : String(error)}`);
        }
    },

    [ScriptOpcode.PROPERTY_LOCK_LEVEL]: state => {
        state.pushInt(propertySecurity(state).lockLevel);
    },

    [ScriptOpcode.PROPERTY_LOCKPICK_EXPERIENCE]: state => {
        state.pushInt(propertySecurity(state).lockpickExperience);
    },

    [ScriptOpcode.PROPERTY_LOCK_CHANCE_NUMERATOR]: state => {
        state.pushInt(propertySecurity(state).successChanceNumerator);
    },

    [ScriptOpcode.PROPERTY_LOCK_CHANCE_DENOMINATOR]: state => {
        state.pushInt(propertySecurity(state).successChanceDenominator);
    },

    [ScriptOpcode.PROPERTY_REQUIRES_LOCKPICK]: state => {
        state.pushInt(propertySecurity(state).requiresLockpick ? 1 : 0);
    },

    [ScriptOpcode.TIMESPENT]: state => {
        state.timespent = performance.now();
    },

    [ScriptOpcode.GETTIMESPENT]: state => {
        const elapsed = performance.now() - state.timespent;

        if (state.popInt() === 1) {
            // microseconds
            state.pushInt(elapsed * 1000);
        } else {
            // milliseconds
            state.pushInt(elapsed);
        }
    }
};

function propertySecurity(state: Parameters<CommandHandlers[number]>[0]) {
    const loc = state.activeLoc;
    const entry = getPropertyRuntime().resolveEntryPoint(loc.x, loc.z, loc.level);
    if (!entry) throw new Error('Property security requires a configured entry point');
    return entry.property.security;
}

export default DebugOps;
