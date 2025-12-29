declare module "@decky/rollup" {
    import type { RollupOptions } from "rollup";

    interface DeckyPluginOptions {
        // Add any specific options here if needed
    }

    export default function deckyPlugin(
        options?: DeckyPluginOptions
    ): RollupOptions;
}
