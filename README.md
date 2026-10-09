# 小提琴辅助应用 PWA

包含四弦空弦调音、第一把位音准练习和摆针节拍器。全部功能在浏览器本机运行，GitHub Pages 仅提供静态文件。

## 本地开发

```bash
npm install
npm run dev
```

电脑上的 `localhost` 可使用麦克风；iPhone 真机调音和音准练习必须通过 HTTPS。

## 构建

```bash
npm run build
npm run preview
```

静态产物位于 `dist/`。GitHub Pages 使用 `main` 分支的 `/docs` 目录；更新时将 `dist/` 的内容同步到 `docs/` 并推送。页面诊断中的构建版本应为 `ui-v4-unified-layout`。

项目页面：<https://z2p5vtnvzn-web.github.io/violin-assistant-pwa/>

## iPhone 真机检查

1. 调音器：拨弦和弓拉四根空弦，确认音高及麦克风停止后资源释放。
2. 音准练习：选定一根弦，连续演奏 1–4 指，确认目标音会自动跟随；也检查手动选指。
3. 节拍器：检查 80 BPM 时点击声与左右摆针同步；分别切换速度、拍号、首拍强调和轻拍测速。6/8 为每个八分音符响一次。
4. 从节拍器返回、切到后台后，确认节拍声已停止。重新进入后点击“开始”恢复。
5. 飞行模式下重新打开已安装 PWA，检查三个页面可进入；其余未完成的离线升级及音频中断验收单独记录。

麦克风音频仅用于本机实时分析，不录音、不上传，也不回放。节拍器用 Web Audio 在本机合成点击声，不需要麦克风。
