//! 绝对 offset → QQ 从 1 开始的页码。每页固定同一上游大小,页内跳过量变化不会改变
//! 绝对起点;最多取两页。第一页不满即已到上游末尾。

use std::future::Future;

use super::Fail;

pub const WINDOW_SIZE: i64 = 50;

/// `fetch(page, num)` 返回 (本页条目, 元信息);返回裁剪后的条目与第一页的元信息。
pub async fn window<T, M, F, Fut>(limit: i64, offset: i64, fetch: F) -> Result<(Vec<T>, M), Fail>
where
    F: Fn(i64, i64) -> Fut,
    Fut: Future<Output = Result<(Vec<T>, M), Fail>>,
{
    if limit <= 0 || offset < 0 {
        return Err(Fail::Invalid);
    }
    let limit = limit.min(WINDOW_SIZE) as usize;
    let (page, skip) = (offset / WINDOW_SIZE, (offset % WINDOW_SIZE) as usize);
    let (first, meta) = fetch(page + 1, WINDOW_SIZE).await?;
    let full = first.len() as i64 == WINDOW_SIZE;
    let mut out: Vec<T> = first.into_iter().skip(skip).take(limit).collect();
    if skip + limit > WINDOW_SIZE as usize && full {
        let (second, _) = fetch(page + 2, WINDOW_SIZE).await?;
        let need = limit - out.len();
        out.extend(second.into_iter().take(need));
    }
    Ok((out, meta))
}
