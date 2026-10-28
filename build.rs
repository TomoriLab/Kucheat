fn main() {
    #[cfg(feature = "gui")]
    {
        for path in [
            "ui",
            "assets/icons",
            "tsconfig.json",
            "tsconfig.tools.json",
            "scripts/build-frontend.ts",
            "package-lock.json",
        ] {
            println!("cargo:rerun-if-changed={path}");
        }
        for arguments in [
            vec![
                "node_modules/typescript/bin/tsc",
                "--project",
                "tsconfig.tools.json",
            ],
            vec!["target/tools/scripts/build-frontend.js"],
        ] {
            let status = std::process::Command::new("node")
                .args(arguments)
                .status()
                .expect("Node.js 24 or later is required to build the TypeScript GUI");
            assert!(
                status.success(),
                "TypeScript frontend build failed; run npm ci and npm run build"
            );
        }
        tauri_build::build();
    }
}
