import { AtUri } from '@atproto/uri'
import AtpAgent from '@atproto/api'
import {
  SPAM,
  OTHER,
} from '@atproto/api/src/client/types/com/atproto/report/reasonType'
import { DevEnv } from '../index'
import { ServerType } from '../types'
import { genServerCfg } from '../util'
import { postTexts, replyTexts } from './data'

// NOTE
// deterministic date generator
// we use this to ensure the mock dataset is always the same
// which is very useful when testing
// (not everything is currently deterministic but it could be)
function* dateGen() {
  let start = 1657846031914
  while (true) {
    yield new Date(start).toISOString()
    start += 1e3
  }
  return ''
}

async function createNeededServers(env: DevEnv, numNeeded = 1) {
  await env.add(await genServerCfg(ServerType.DidPlaceholder))
  while (env.listOfType(ServerType.PersonalDataServer).length < numNeeded) {
    await env.add(await genServerCfg(ServerType.PersonalDataServer))
  }
}

export async function generateMockSetup(env: DevEnv) {
  const date = dateGen()
  await createNeededServers(env)

  const rand = (n: number) => Math.floor(Math.random() * n)
  const picka = <T>(arr: Array<T>): T => {
    if (arr.length) {
      return arr[rand(arr.length)] || arr[0]
    }
    throw new Error('Not found')
  }

  const clients = {
    loggedout: env.listOfType(ServerType.PersonalDataServer)[0].getClient(),
    alice: env.listOfType(ServerType.PersonalDataServer)[0].getClient(),
    bob: env.listOfType(ServerType.PersonalDataServer)[0].getClient(),
    carla: env.listOfType(ServerType.PersonalDataServer)[0].getClient(),
  }
  interface User {
    email: string
    did: string
    declarationCid: string
    handle: string
    password: string
    agent: AtpAgent
  }
  const users: User[] = [
    {
      email: 'alice@test.com',
      did: '',
      declarationCid: '',
      handle: `alice.test`,
      password: 'hunter2',
      agent: clients.alice,
    },
    {
      email: 'bob@test.com',
      did: '',
      declarationCid: '',
      handle: `bob.test`,
      password: 'hunter2',
      agent: clients.bob,
    },
    {
      email: 'carla@test.com',
      did: '',
      declarationCid: '',
      handle: `carla.test`,
      password: 'hunter2',
      agent: clients.carla,
    },
  ]
  const alice = users[0]
  const bob = users[1]
  const carla = users[2]

  let _i = 1
  for (const user of users) {
    const res = await clients.loggedout.api.com.atproto.account.create({
      email: user.email,
      handle: user.handle,
      password: user.password,
    })
    user.agent.api.setHeader('Authorization', `Bearer ${res.data.accessJwt}`)
    const { data: profile } = await user.agent.api.app.bsky.actor.getProfile({
      actor: user.handle,
    })
    user.did = res.data.did
    user.declarationCid = profile.declaration.cid
    await user.agent.api.app.bsky.actor.profile.create(
      { did: user.did },
      {
        displayName: ucfirst(user.handle).slice(0, -5),
        description: `Test user ${_i++}`,
      },
    )
  }

  // Report one user
  const reporter = picka(users)
  await reporter.agent.api.com.atproto.report.create({
    reasonType: picka([SPAM, OTHER]),
    reason: picka(["Didn't look right to me", undefined, undefined]),
    subject: {
      $type: 'com.atproto.repo.repoRef',
      did: picka(users).did,
    },
  })

  // everybody follows everybody
  const follow = async (author: User, subject: User) => {
    await author.agent.api.app.bsky.graph.follow.create(
      { did: author.did },
      {
        subject: {
          did: subject.did,
          declarationCid: subject.declarationCid,
        },
        createdAt: date.next().value,
      },
    )
  }
  await follow(alice, bob)
  await follow(alice, carla)
  await follow(bob, alice)
  await follow(bob, carla)
  await follow(carla, alice)
  await follow(carla, bob)

  // a set of posts and reposts
  const posts: { uri: string; cid: string }[] = []
  for (let i = 0; i < postTexts.length; i++) {
    const author = picka(users)
    const post = await author.agent.api.app.bsky.feed.post.create(
      { did: author.did },
      {
        text: postTexts[i],
        createdAt: date.next().value,
      },
    )
    posts.push(post)
    if (rand(10) === 0) {
      const reposter = picka(users)
      await reposter.agent.api.app.bsky.feed.repost.create(
        { did: reposter.did },
        {
          subject: picka(posts),
          createdAt: date.next().value,
        },
      )
    }
    if (rand(6) === 0) {
      const reporter = picka(users)
      await reporter.agent.api.com.atproto.report.create({
        reasonType: picka([SPAM, OTHER]),
        reason: picka(["Didn't look right to me", undefined, undefined]),
        subject: {
          $type: 'com.atproto.repo.recordRef',
          uri: post.uri,
        },
      })
    }
  }

  // a set of replies
  for (let i = 0; i < 100; i++) {
    const targetUri = picka(posts).uri
    const urip = new AtUri(targetUri)
    const target = await alice.agent.api.app.bsky.feed.post.get({
      user: urip.host,
      rkey: urip.rkey,
    })
    const author = picka(users)
    posts.push(
      await author.agent.api.app.bsky.feed.post.create(
        { did: author.did },
        {
          text: picka(replyTexts),
          reply: {
            root: target.value.reply ? target.value.reply.root : target,
            parent: target,
          },
          createdAt: date.next().value,
        },
      ),
    )
  }

  // a set of up/downvotes
  for (const post of posts) {
    for (const user of users) {
      if (rand(3) === 0) {
        await user.agent.api.app.bsky.feed.vote.create(
          { did: user.did },
          {
            direction: rand(3) !== 0 ? 'up' : 'down',
            subject: post,
            createdAt: date.next().value,
          },
        )
      }
    }
  }
}

function ucfirst(str: string): string {
  return str.at(0)?.toUpperCase() + str.slice(1)
}
