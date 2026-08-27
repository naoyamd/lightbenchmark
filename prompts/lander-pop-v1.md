# Lander Pop

Prompt version: `LANDER-1.0`

`common-coding-v1.md`の本文へ次を連結する。

```text
課題: Lander Pop

2Dのロケット垂直着陸toy simulationを作り、自作controllerで初期状態から自動着陸させてください。候補controllerには位置と姿勢の観測だけを渡し、速度は履歴から推定してください。

ファイル:
- submission/site/index.html
- submission/site/sim.mjs
- submission/site/controller.mjs

座標と状態:
- y=0が地面、正のyが上、theta=0が直立です。
- state={t,x,y,vx,vy,theta,omega,fuel}
- dt=0.02秒。
- controllerは0.10秒ごとに呼び、返したcontrolを5 physics step保持します。
- control={throttle,gimbal}
- throttleは[0,1]、gimbalは[-0.35,0.35] radへclampします。

baseline parameter:
g=9.81
aMax=22
K=8
C=0.8
windAmp=0.2
padX=0
padHalf=6
fuel0=0.65

physics stepは現在時刻tを使い、次の順で半陰的Eulerを適用します。
u = fuel>0 ? clamp(throttle,0,1) : 0
delta = clamp(gimbal,-0.35,0.35)
aT = aMax*u
wind = windAmp*sin(0.31*t+phase)
ax = aT*sin(theta+delta)+wind
ay = aT*cos(theta+delta)-g
omega += dt*(K*u*delta-C*omega)
theta += dt*omega
vx += dt*ax
x += dt*vx
vy += dt*ay
y += dt*vy
fuel = max(0,fuel-0.045*u*dt)
t += dt

seed:
- uint32のxorshift32を使い、seed=0は1とします。各nextは x^=x<<13、x^=x>>>17、x^=x<<5 の順で32bit演算し、x>>>0を返します。
- 各乱数rは nextUint32()/2^32。
- x,y,vx,vy,theta,omega,phaseの順で生成します。
- xは[-28,28]、yは[90,120]、vxは[-6,6]、vyは[-24,-14]。
- thetaは[-0.18,0.18]、omegaは[-0.08,0.08]、phaseは[0,2π)。
- 公開seedは0x5EED1234です。

controller.mjs:
- export function createController() を実装してください。
- 戻り値は { step(sensor) } です。
- sensorは0.10秒ごとの {t,altitude,xOffset,theta,fuel} だけです。
- xOffset=x-padXです。各値は小数第2位へ丸められます。
- vx、vy、omega、g、aMax、wind、phase、内部stateは渡されません。
- controller.mjsはsim.mjsやDOMをimport・参照せず、sensor履歴だけを使ってください。

sim.mjs:
- createScenario(seed,overrides={})
- stepPhysics(state,control,params)
- makeSensor(state,params)
- classify(state,params)
をexportしてください。createScenarioは {state,params} を返し、phaseはparamsに含めます。stepPhysicsは新しいstateを返してください。classifyは flying、landed、hard-crash、off-pad、tip-over、out-of-bounds、timeout のいずれかを返します。引数を破壊しないでください。

接地時、次をすべて満たせばlandedです。
abs(x-padX)<=padHalf
abs(vx)<=2
abs(vy)<=3
abs(theta)<=8度
abs(omega)<=15度/秒

classifyは次の優先順で判定してください。
- abs(theta)>90度ならtip-over。
- abs(x)>80mまたはy>180mならout-of-bounds。
- t>=20秒ならtimeout。
- y>0ならflying。
- 接地してabs(x-padX)>padHalfならoff-pad。
- 接地してabs(theta)>8度またはabs(omega)>15度/秒ならtip-over。
- 接地してabs(vx)>2またはabs(vy)>3ならhard-crash。
- それ以外の接地はlanded。

したがって以下はfailです。
- 接地時に安全条件を1つでも外す。
- abs(theta)>90度。
- abs(x)>80m。
- y>180m。
- t>=20秒。

判定は各physics step後に行います。ブラウザのframe時間をphysicsへ使用しないでください。

未知評価では次の範囲内でparameterが変わります。
g: 9.4〜10.2
aMax: 20.5〜23.5
windAmp: 0〜0.4
padX: -10〜10
padHalf: 5.5〜6.5
fuel0: 0.55〜0.75

画面:
- rocket、engine flame、landing pad、風、trajectory、altitude、fuel、姿勢、statusを表示する。
- estimated velocityと、終了後にだけ確認できるtrue velocityを区別して表示する。
- x1、x4、x16、Pause、Replayを用意する。
- success、hard crash、off-pad、tip-over、timeoutを見た目で区別する。
- 「教育用toy simulation・実飛行に使用不可」と表示する。
- window.__LIGHTBENCH__ に reset、run、snapshot、telemetry を公開する。
- telemetryは各stepのstate、sensor、control、statusを含める。
```
