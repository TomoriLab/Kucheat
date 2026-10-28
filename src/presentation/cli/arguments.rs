use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "kucheat")]
#[command(version, about = "CHZZK 라이브 알림 시스템 트레이 앱")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Commands>,
}

#[derive(Debug, Subcommand)]
pub enum AutoLaunchCommand {
    /// 자동 실행을 위한 .desktop 파일을 ~/.config/autostart/ 에 설치합니다
    Install,
    /// 자동 실행을 비활성화합니다
    Uninstall,
}

#[derive(Debug, Subcommand)]
pub enum Commands {
    /// 데스크톱 앱 실행
    Gui,
    /// 라이브 체크 데몬 실행 (systemd&auto-launch 용)
    Daemon,
    /// 시스템 트레이 앱 실행
    Tray,
    /// 모니터링할 채널 추가
    Add {
        /// 채널 ID
        channel_id: String,
        /// 채널 이름 (미지정 시 API에서 자동 조회)
        #[arg(short, long)]
        name: Option<String>,
    },
    /// 모니터링 채널 제거
    Remove {
        /// 채널 ID
        channel_id: String,
    },
    /// 모니터링 중인 채널 목록
    List,
    /// 현재 라이브 상태 조회
    Status,
    /// 자동 실행 상태를 관리
    AutoLaunch {
        #[command(subcommand)]
        command: AutoLaunchCommand,
    },
}
