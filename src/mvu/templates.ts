// Ready-made variable sets a newcomer can drop in and then rename / adjust.
// Rules are written as plain instructions to the AI, one per line.
import { newId } from '../lib/id';
import type { VarNode } from './types';

type Draft = Omit<VarNode, 'id' | 'rules' | 'children'> & { rules?: string[]; children?: Draft[] };

const make = (d: Draft): VarNode => ({ ...d, id: newId(), rules: d.rules ?? [], children: d.children?.map(make) });

export interface VarTemplate {
  name: string;
  /** one line shown in the menu */
  about: string;
  build: () => VarNode[];
}

export const TEMPLATES: VarTemplate[] = [
  {
    name: '时间和地点',
    about: '日期、时间段、所在地点',
    build: () => [
      make({
        name: '世界',
        kind: 'group',
        children: [
          { name: '日期', kind: 'text', init: '第1天', rules: ['剧情跨过一天时更新，写成「第N天」'] },
          { name: '时间', kind: 'choice', options: ['清晨', '上午', '中午', '下午', '傍晚', '夜晚', '深夜'], init: '清晨', rules: ['按剧情里过去的时间推进'] },
          { name: '地点', kind: 'text', init: '酒馆', rules: ['角色移动到新的地方时更新'] },
        ],
      }),
    ],
  },
  {
    name: '角色好感',
    about: '好感度（带阶段）、心情、当前想法',
    build: () => [
      make({
        name: '角色名',
        kind: 'group',
        children: [
          {
            name: '好感度',
            kind: 'number',
            init: 0,
            min: 0,
            max: 100,
            integer: true,
            stages: [
              { from: 0, label: '陌生' },
              { from: 20, label: '熟人' },
              { from: 40, label: '朋友' },
              { from: 60, label: '好友' },
              { from: 80, label: '挚爱' },
            ],
            rules: ['友善、体贴的互动 +1~3', '特别打动对方的事 +5', '冒犯、伤害对方 -3~-10', '每轮变化不超过 10'],
          },
          { name: '心情', kind: 'choice', options: ['平静', '开心', '难过', '生气', '害羞', '紧张'], init: '平静', rules: ['按这一轮发生的事更新'] },
          { name: '当前想法', kind: 'text', init: '', rules: ['用一句话写角色此刻心里在想什么'] },
        ],
      }),
    ],
  },
  {
    name: '金钱',
    about: '一个不会小于 0 的数字',
    build: () => [make({ name: '金钱', kind: 'number', init: 100, min: 0, integer: true, rules: ['买东西时减少，拿到报酬时增加'] })],
  },
  {
    name: '物品栏',
    about: '物品名 → 描述、数量；数量为 0 自动删掉',
    build: () => [
      make({
        name: '物品栏',
        kind: 'table',
        rowName: '物品名',
        dropRowWhenZero: '数量',
        init: {},
        rules: ['获得新物品时加一行，用掉时减少数量'],
        children: [
          { name: '描述', kind: 'text', init: '' },
          { name: '数量', kind: 'number', init: 1, min: 0, integer: true },
        ],
      }),
    ],
  },
  {
    name: '任务',
    about: '任务名 → 目标、状态',
    build: () => [
      make({
        name: '任务',
        kind: 'table',
        rowName: '任务名',
        init: {},
        rules: ['接到新任务时加一行', '任务完成或失败时改状态'],
        children: [
          { name: '目标', kind: 'text', init: '' },
          { name: '状态', kind: 'choice', options: ['进行中', '已完成', '失败'], init: '进行中' },
        ],
      }),
    ],
  },
  {
    name: '人物关系',
    about: '人物 → 关系、好感、印象',
    build: () => [
      make({
        name: '人物关系',
        kind: 'table',
        rowName: '人物',
        init: {},
        rules: ['遇到新的重要人物时加一行', '关系或印象改变时更新'],
        children: [
          { name: '关系', kind: 'text', init: '陌生人' },
          { name: '好感', kind: 'number', init: 0, min: -100, max: 100, integer: true },
          { name: '印象', kind: 'text', init: '' },
        ],
      }),
    ],
  },
  {
    name: '角色状态',
    about: '生命、体力、身上的状态（中毒、受伤…）',
    build: () => [
      make({
        name: '主角',
        kind: 'group',
        children: [
          { name: '生命', kind: 'number', init: 100, min: 0, max: 100, integer: true, rules: ['受伤时减少，治疗或休息时恢复'] },
          { name: '体力', kind: 'number', init: 100, min: 0, max: 100, integer: true, rules: ['剧烈活动时减少，休息时恢复'] },
          { name: '状态', kind: 'list', init: [], rules: ['出现中毒、受伤等状态时加入，好了就删掉'] },
        ],
      }),
    ],
  },
  {
    name: '跑团属性',
    about: '六项属性（AI 不能改）、等级、经验',
    build: () => [
      make({
        name: '属性',
        kind: 'group',
        children: ['力量', '敏捷', '体质', '智力', '感知', '魅力'].map((name): Draft => ({ name, kind: 'number', init: 10, min: 1, max: 20, integer: true, readonly: true })),
      }),
      make({
        name: '成长',
        kind: 'group',
        children: [
          { name: '等级', kind: 'number', init: 1, min: 1, max: 20, integer: true, rules: ['经验满 100 时升一级，经验清零'] },
          { name: '经验', kind: 'number', init: 0, min: 0, integer: true, rules: ['完成任务或战斗胜利时增加'] },
        ],
      }),
    ],
  },
];

/** What a brand-new card starts with. */
export const starterVars = (): VarNode[] => [...TEMPLATES[0].build(), ...TEMPLATES[1].build()];
