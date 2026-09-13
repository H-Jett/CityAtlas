// 入口：解析 URL → 决定渲染首页还是城市页 → 装配各模块。
// 骨架阶段先只证明静态资源链路通，后续步骤逐步接上数据、地图与编辑器。

const app = document.getElementById('view-home');

app.hidden = false;
document.getElementById('city-grid').innerHTML =
  '<div class="empty"><div class="big">🗺️</div>加载中…</div>';
