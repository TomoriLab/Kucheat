use crate::application::ports::{BrowserLauncher, PortFuture};

pub struct SystemBrowserLauncher;

impl BrowserLauncher for SystemBrowserLauncher {
    fn open<'a>(&'a self, url: &'a str) -> PortFuture<'a, ()> {
        let url = url.to_owned();
        Box::pin(async move {
            tokio::task::spawn_blocking(move || open::that(url)).await??;
            Ok(())
        })
    }
}
