# Lander Pop

Prompt version: `LANDER-2.0`

`common-coding-v1.3.md`の本文へ次を連結する。

```text
課題: Lander Pop

物理とGNCが必要な2Dロケット垂直着陸toy simulationを作り、自作controllerで初期状態から自動着陸させてください。候補controllerには位置・姿勢・高度・燃料の観測だけを渡し、速度と角速度はセンサー履歴から推定してください。これは教育用toy simulationであり、実飛行・実機制御には使用できません。

ファイル:
- submission/site/index.html
- submission/site/sim.mjs
- submission/site/controller.mjs

座標・公開状態・時間:
- y=0が地面、正のyが上、theta=0が直立です。
- state={t,x,y,vx,vy,theta,omega,fuel,throttleActual,gimbalActual}。最初の8値の意味とcontrolの入力形は従来契約から変えず、最後の2値はsim内部で更新する実アクチュエータ状態です。
- dt=0.02秒。controllerは0.10秒ごとに呼び、返したcontrolを5 physics step保持します。
- control={throttle,gimbal}。throttleは[0,1]、gimbalは[-0.35,0.35] radへclampします。
- 引数のstate、control、paramsは破壊せず、stepPhysicsは新しいstateを返してください。

baseline parameter:
g=9.81
aMax=22
K=8
C=0.8
windAmp=0.2
gustAmp=0.08
dragCoeff=0.0025
padX=0
padHalf=6
fuel0=0.65
phase=0（seedから生成する場合はparamsへ含める）

未知評価で変わるparameter範囲:
- g: 9.4〜10.2
- aMax: 20.5〜23.5
- windAmp: 0〜0.4
- gustAmp: 0〜0.2
- dragCoeff: 0〜0.01
- padX: -10〜10
- padHalf: 5.5〜6.5
- fuel0: 0.55〜0.75
- phase: 0以上2π未満

physics stepは現在時刻tを使い、次の順で半陰的Eulerを適用します。
1. throttleActual += (clamp(throttle,0,1)-throttleActual) * (1-exp(-dt/0.18))
2. gimbalActual += (clamp(gimbal,-0.35,0.35)-gimbalActual) * (1-exp(-dt/0.12))
3. u = fuel>0 ? throttleActual : 0
4. delta = gimbalActual
5. fuelRatio = clamp(fuel/fuel0,0,1)
6. aT = aMax*u*(1.12-0.12*fuelRatio)
7. wind = windAmp*sin(0.07*t+phase) + gustAmp*sin(2.3*t+0.5*phase)
8. ax = aT*sin(theta+delta) + wind - dragCoeff*vx*abs(vx)
9. ay = aT*cos(theta+delta) - g - dragCoeff*vy*abs(vy)
10. omega += dt*(K*u*delta-C*omega)
11. theta += dt*omega
12. vx += dt*ax
13. x += dt*vx
14. vy += dt*ay
15. y += dt*vy
16. fuel = max(0,fuel-0.045*u*dt)
17. t += dt

seed:
- uint32のxorshift32を使い、seed=0は1とします。各nextは x^=x<<13、x^=x>>>17、x^=x<<5 の順で32bit演算し、x>>>0を返します。
- 各乱数rは nextUint32()/2^32。
- x,y,vx,vy,theta,omega,phaseの順で生成します。
- xは[-28,28]、yは[90,120]、vxは[-6,6]、vyは[-24,-14]、thetaは[-0.18,0.18]、omegaは[-0.08,0.08]、phaseは[0,2π)です。
- 公開seedは0x5EED1234です。

controller.mjs:
- export function createController() を実装してください。戻り値は { step(sensor) } です。
- sensorは0.10秒ごとの {t,altitude,xOffset,theta,fuel} だけです。xOffset=x-padXです。各値は小数第2位へ丸められます。
- vx、vy、omega、g、aMax、wind、phase、throttleActual、gimbalActual、内部sim stateは渡されません。速度・角速度はsensor履歴だけから推定してください。
- controller.mjsはsim.mjs、rocket.mjs、DOMをimport・参照せず、sensor履歴だけを使ってください。

sim.mjs:
- createScenario(seed,overrides={})
- stepPhysics(state,control,params)
- makeSensor(state,params)
- classify(state,params)
をexportしてください。createScenarioは {state,params} を返し、phaseと実アクチュエータ初期値0をparams/stateに含めてください。makeSensorのキーは {t,altitude,xOffset,theta,fuel} だけにしてください。

classifyは flying、landed、hard-crash、off-pad、tip-over、out-of-bounds、timeout のいずれかを返し、次の優先順で各physics step後に判定してください。
- abs(theta)>90度ならtip-over。
- abs(x)>80mまたはy>180mならout-of-bounds。
- t>=20秒ならtimeout。
- y>0ならflying。
- 接地してabs(x-padX)>padHalfならoff-pad。
- 接地してabs(theta)>8度またはabs(omega)>15度/秒ならtip-over。
- 接地してabs(vx)>2またはabs(vy)>3ならhard-crash。
- それ以外の接地はlanded。

公開再演シナリオ（public-v1）:
- 公開seed=0x5EED1234を固定入力にし、reset→runを繰り返しても同じphysics state、sensor、control、status、event logになるようにしてください。乱数、現在時刻、ブラウザframe時間、DOM表示へ結果を依存させないでください。
- x1/x4/x16などの速度表示はanimationだけを変え、physicsのdtとstep順序を変えてはいけません。

画面:
- [data-lightbench-stage] を作品の主役とするfull viewport stageを作ってください。
- 大きなロケット本体、脚、可変長のエンジンプルーム、landing pad、trajectory、風の向きと強さ、approach corridor、地面を必須表示にしてください。
- flying、成功着地、hard crash、off-pad、tip-over、out-of-bounds、timeoutの失敗挙動を実stateから視覚的に区別してください。予定された成功文言だけを表示してはいけません。
- telemetry panelや長い説明dashboardは作らず、altitude、estimated velocity、fuel、姿勢、風、statusから4〜6値だけを選んだ小さなoverlay HUDにしてください。操作用Manual/Speed/Pause/Replay UIは外側parentが提供します。
- 「教育用toy simulation・実飛行に使用不可」を短く表示してください。
- window.__LIGHTBENCH__ に reset、run、snapshot、telemetry を公開してください。resetは進行中のtimer/animationを停止してpublic-v1の初期stateと空のevent logへ戻してください。runはPromiseを返し、終端physics stepの結果を描画する最後のanimation/frameまで終わってからresolveしてください。
- telemetry/event logは各stepで実際に生成したstate、sensor、control、classifyによるstatusを含め、画面表示とsnapshotはそこから導出してください。外部へ返すstate/logはcopyにしてください。
```
