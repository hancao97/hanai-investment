我想做一个客户端，名字叫做 hanai investment， 你可以参考 hancao97/hanai-wealth 部分逻辑，我希望至少有几个功能： 
1. 结合hanai-wealth 中的价值大师网接口调用，作为 股票详情价值判断 
2. 列表股票清单，我们最好可以用 东方财富之类的接口，可以实时检索（hanai-wealth 是定时拉的，列表不能这样了） 
3. 我需要有dashboard 页面，可以展示a股今日面板，类似图片1中的方式，板块涨跌啥的，注意注意，我需要做的炫酷 
4. 我会用 alchaincyf/nuwa-skill 搞出巴菲特，芒格，巴菲特，段永平等角色，把他们常驻在我的客户端上，我可以和他们单独对话，也可以让他们变成一个群组讨论股票价值，是否可以投资 
5. 我agent 能力我希望依赖用户本机的codex（codex 好像有appserver 等能力，可以考虑用），当然客户端上需要检查环境是否有codex  
6. 客户端数据留在 ~/.hanai-investment 中，agent 运行目录就缺省放在 ~/.hanai-investment/runtime/workdir 中